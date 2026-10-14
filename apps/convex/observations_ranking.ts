// ─── Observation ranking maths (issue #487) ─────────────────────────────────
//
// The pure half of the daily scoring job: how an eligible pool of
// Observations is turned into an `engagementScore` and a `replicationScore`.
// Deliberately free of any Convex import so it stays unit-testable against
// plain fixtures alone — `observations_scoring_daily.ts` owns the job wiring
// (fan-out, paged reads, batched writes) that calls into here.

/** Eligibility window (issue #487): only Observations captured within the
 * last `OBSERVATION_LOOKBACK_DAYS` days are scored. */
export const OBSERVATION_LOOKBACK_DAYS = 7;

/** Below this many members, a group's percentile rank is meaningless (too
 * few points to spread over [0, 1] usefully) — every member gets
 * `NEUTRAL_ENGAGEMENT_SCORE` instead (issue #487). */
export const MIN_GROUP_SIZE_FOR_PERCENTILE = 5;

/** The "no usable ranking signal" engagement score: the flat middle of
 * [0, 1], handed to every member of a group too small to percentile-rank. */
const NEUTRAL_ENGAGEMENT_SCORE = 0.5;

/** Group A's weighted engagement *rate* (issue #487), named for the same
 * reason as `REPLICATION_WEIGHTS` below — so the formula reads as weights
 * rather than bare literals. */
export const ENGAGEMENT_RATE_WEIGHTS = {
  like: 0.15,
  comment: 0.2,
  share: 0.35,
  save: 0.3,
} as const;

/** `computeReplicationScore`'s fixed weights (issue #487), named so the
 * formula reads as `engagementScore * REPLICATION_WEIGHTS.engagement + ...`
 * rather than bare literals. */
export const REPLICATION_WEIGHTS = {
  engagement: 0.4,
  productFit: 0.25,
  replicability: 0.2,
  creativeStrength: 0.15,
} as const;

/** Everything `computeEngagementScores` needs about one Observation. A
 * structural subset of `Doc<"sources">`, kept independent of the
 * generated type so the pure function stays unit-testable against plain
 * fixtures alone — same precedent as `ObservationForInsight` (the removed
 * insights.ts). */
export type ObservationForEngagementScore = {
  id: string;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  saveCount?: number;
  // `rawEngagementScore` is already computed once, at deep-enrichment
  // completion, and
  // stored on the row — Group B reads it directly rather than recomputing
  // it from counts, so there's exactly one place the raw-engagement formula
  // lives.
  rawEngagementScore?: number;
};

export type EngagementScoreResult = { id: string; engagementScore: number };

type RankEntry = { id: string; value: number };

/**
 * Scores one group on [0, 1]. A group with fewer than
 * `MIN_GROUP_SIZE_FOR_PERCENTILE` members has too little spread for a rank
 * to mean anything and gets a flat `NEUTRAL_ENGAGEMENT_SCORE` (issue #487);
 * anything larger is percentile-ranked with fractional/competition ranking:
 * sort ascending, and a tied group of values all receive the rank of the
 * *first* index in that tie (0-based), so equal inputs get equal (not just
 * close) outputs. The rank is then normalized to `[0, 1]` by dividing by
 * `n - 1` (issue #487 doesn't specify a numeric definition beyond
 * "percentile-ranked" — this is the standard "percentile rank" definition:
 * fraction of the group at or below this value's rank position).
 *
 * Both groups go through this one function so the small-group fallback and
 * the ranking definition each live in exactly one place.
 */
function rankGroup(entries: RankEntry[]): Map<string, number> {
  const n = entries.length;
  if (n < MIN_GROUP_SIZE_FOR_PERCENTILE) {
    return new Map(entries.map((entry) => [entry.id, NEUTRAL_ENGAGEMENT_SCORE]));
  }

  const result = new Map<string, number>();
  const sorted = [...entries].sort((a, b) => a.value - b.value);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sorted[j + 1].value === sorted[i].value) j++;
    const rank = i / (n - 1);
    for (let k = i; k <= j; k++) result.set(sorted[k].id, rank);
    i = j + 1;
  }
  return result;
}

/**
 * Whether this Observation belongs to Group A — a *usable* view count.
 * `viewCount` is stored verbatim from the report (`observations.ts`
 * `optionalNumber`), so a literal `0` is a value the pipeline really does
 * produce; dividing counts by it would yield `NaN`/`Infinity`, which poisons
 * the sort comparator and the tie check in `rankGroup` for the *whole* group
 * and could be persisted as an Observation's score. A post with zero
 * recorded views has no rate to speak of, so it ranks on raw counts in
 * Group B instead.
 */
function hasKnownViewCount(
  observation: ObservationForEngagementScore,
): observation is ObservationForEngagementScore & { viewCount: number } {
  return observation.viewCount !== undefined && observation.viewCount > 0;
}

/**
 * Splits the eligible pool into two groups and percentile-ranks each
 * independently (issue #487): Group A (`viewCount` known) by a weighted
 * engagement *rate* (counts normalized by views), Group B (`viewCount`
 * unknown) by `log1p(rawEngagementScore)` (a raw, unnormalized count —
 * log-compressed so a handful of viral outliers don't flatten the rest of
 * the group's spread). Groups are never mixed for ranking — a Group A row
 * with a mediocre rate never competes against a Group B row's log-count on
 * the same scale, since the two aren't comparable. Missing counts count as
 * `0`.
 *
 * Returns one result per input, **in input order** — callers zip the two
 * arrays by index rather than looking each id back up.
 */
export function computeEngagementScores(
  observations: ObservationForEngagementScore[],
): EngagementScoreResult[] {
  const groupA: RankEntry[] = [];
  const groupB: RankEntry[] = [];

  // Group membership is decided once here, not re-derived later — every
  // Observation's id lands in exactly one of the two disjoint groups, so the
  // two ranked maps below can be merged rather than looked up conditionally.
  for (const observation of observations) {
    if (hasKnownViewCount(observation)) {
      const views = observation.viewCount;
      const rate =
        ENGAGEMENT_RATE_WEIGHTS.like * ((observation.likeCount ?? 0) / views) +
        ENGAGEMENT_RATE_WEIGHTS.comment * ((observation.commentCount ?? 0) / views) +
        ENGAGEMENT_RATE_WEIGHTS.share * ((observation.shareCount ?? 0) / views) +
        ENGAGEMENT_RATE_WEIGHTS.save * ((observation.saveCount ?? 0) / views);
      groupA.push({ id: observation.id, value: rate });
    } else {
      groupB.push({
        id: observation.id,
        value: Math.log1p(observation.rawEngagementScore ?? 0),
      });
    }
  }

  const engagementScoreById = new Map([...rankGroup(groupA), ...rankGroup(groupB)]);

  return observations.map((observation) => ({
    id: observation.id,
    engagementScore: engagementScoreById.get(observation.id) ?? NEUTRAL_ENGAGEMENT_SCORE,
  }));
}

export type ReplicationScoreInput = {
  engagementScore: number;
  productFit: number;
  replicability: number;
  creativeStrength: number;
};

/**
 * `replicationScore` (issue #487): a fixed weighted sum of the just-computed
 * `engagementScore` and the three rubric scores written at deep-enrichment
 * completion (issue #486).
 */
export function computeReplicationScore(input: ReplicationScoreInput): number {
  return (
    input.engagementScore * REPLICATION_WEIGHTS.engagement +
    input.productFit * REPLICATION_WEIGHTS.productFit +
    input.replicability * REPLICATION_WEIGHTS.replicability +
    input.creativeStrength * REPLICATION_WEIGHTS.creativeStrength
  );
}

// ─── Daily Top-1 selection (issue #488) ─────────────────────────────────────

/** The quality bar a day's top `replicationScore` must clear (inclusive) for
 * a winner to be picked at all — otherwise the daily job selects nothing for
 * that Instance rather than force a mediocre pick (issue #484/#488). Global,
 * not per-Instance configuration, same as the other ranking constants above. */
export const MIN_REPLICATION_SCORE = 0.7;

/** Everything `pickTopEligible` needs about one candidate — a structural
 * subset so it stays testable against plain fixtures, same precedent as
 * `ObservationForEngagementScore` above. */
export type ScoredCandidate = { id: string; replicationScore: number };

/**
 * Pure Top-1 selection (issue #488): given an eligible pool whose
 * `replicationScore`s are already computed, returns the strict-highest
 * scorer, or `null` when the pool is empty or the top score doesn't clear
 * `MIN_REPLICATION_SCORE` (inclusive — a score exactly at the bar still
 * wins).
 *
 * Tie-break, defined even though not expected to matter in practice: the
 * *first* candidate in input order among those sharing the top score wins —
 * a stable, deterministic rule rather than leaving simultaneous re-runs to
 * pick arbitrarily between equally-good candidates.
 */
export function pickTopEligible<T extends ScoredCandidate>(candidates: T[]): T | null {
  let best: T | null = null;
  for (const candidate of candidates) {
    if (best === null || candidate.replicationScore > best.replicationScore) {
      best = candidate;
    }
  }
  return best !== null && best.replicationScore >= MIN_REPLICATION_SCORE ? best : null;
}
