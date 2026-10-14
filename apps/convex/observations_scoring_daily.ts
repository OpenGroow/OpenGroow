import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import {
  computeEngagementScores,
  computeReplicationScore,
  OBSERVATION_LOOKBACK_DAYS,
  pickTopEligible,
  type ObservationForEngagementScore,
} from "./observations_ranking.js";
import { engagementCountsOf, scoreOf } from "./sources_social.js";

// ─── Daily engagement/replication scoring (issue #487) ──────────────────────
//
// A daily, per-Instance job that ranks every eligible Observation against its
// peers and computes a `replicationScore` from that rank plus the fixed
// rubric scores written at deep-enrichment completion (issue #486). This
// module writes those scores onto Observation rows and nothing else: the
// ranking maths lives in `observations_ranking.ts`, and the generic
// `source_routing` Job owns what to do with the day's winner. This module only
// computes and persists scores.
//
// Mirrors the shape of `insights.consolidate`/`consolidateAll` used before
// their removal (issue #485): an `internalAction` fan-out over every
// provisioned Instance, a per-Instance `internalAction` that walks a paged
// `internalQuery` read, and a batched `internalMutation` write — so no single
// transaction ever has to hold an Instance's whole, unbounded Observation
// history (`_generated/ai/guidelines.md`: "instead of using `.collect()` you
// should use `.take()` or paginate").

// Issue #535: the pool is now the Instance's Sources (migrated Observations
// and, later, SourceJob-written ones). What an Observation called
// `enrichmentStatus === "completed"` is a `ready` Source, and the rubric and
// engagement scores live in `Source.scoring`.

/** A Source that passed `toScorable` — the three rubric scores are present,
 * so `computeReplicationScore` needs no casts at the call site. */
type ScorableObservation = {
  source: Doc<"sources">;
  productFit: number;
  replicability: number;
  creativeStrength: number;
};

/** The trimmed Observation shape the scoring walk carries across pages —
 * everything the ranking maths needs and nothing else, so a whole Instance's
 * eligible pool stays cheap to hold in the action's memory. */
type EligibleObservation = ObservationForEngagementScore & {
  id: Id<"sources">;
  productFit: number;
  replicability: number;
  creativeStrength: number;
};

/**
 * Issue #487's eligibility rule, per Instance: deep-enriched, not excluded,
 * not yet selected, and captured within the lookback window. The issue's
 * prose names ("deepEnriched", "observedAt") don't exist as fields on
 * `observations` — `enrichmentStatus === "completed"` is the only lifecycle
 * state that means "deep-enriched" (schema.ts, and the clause the page query
 * below serves from an index), and `capturedAt` is where report.json's
 * `observedAt` lands at insert time (observations.ts). Also requires the
 * three rubric scores to be present: `enrichmentStatus` flips to
 * `"completed"` synchronously, but `productFit`/`replicability`/
 * `creativeStrength` are filled in by a separately scheduled, best-effort
 * LLM call that can still be
 * pending or have failed — without a `productFit` etc. yet, this Observation
 * isn't actually scorable (its `replicationScore` would be `NaN`), so it sits
 * out this run and is picked up by the next daily one.
 */
function toScorable(source: Doc<"sources">, now: number): ScorableObservation | undefined {
  const productFit = scoreOf(source, "productFit");
  const replicability = scoreOf(source, "replicability");
  const creativeStrength = scoreOf(source, "creativeStrength");
  if (
    source.status !== "ready" ||
    // Pre-#486 rows carry no `excluded` at all — schema.ts: readers must
    // treat `undefined` as "not excluded".
    source.excluded === true ||
    source.selectedAt !== undefined ||
    source.capturedAt < now - OBSERVATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000 ||
    // A future-dated `capturedAt` (clock skew, bad client data) must not pass
    // the lookback check on its lower bound alone — cap it at `now` too.
    source.capturedAt > now ||
    productFit === undefined ||
    replicability === undefined ||
    creativeStrength === undefined
  ) {
    return undefined;
  }
  return { source, productFit, replicability, creativeStrength };
}

function toEligibleObservation({ source, productFit, replicability, creativeStrength }: ScorableObservation): EligibleObservation {
  return {
    id: source._id,
    ...engagementCountsOf(source),
    rawEngagementScore: scoreOf(source, "rawEngagementScore"),
    productFit,
    replicability,
    creativeStrength,
  };
}

/** One `scoreEligibleForInstance` page's worth of Observations, one
 * `writeScores` batch, and one page of Instances — each bounded so neither
 * the read nor the write transaction outgrows Convex's per-transaction
 * budget. */
const OBSERVATIONS_PAGE_SIZE = 200;
const SCORE_WRITE_BATCH_SIZE = 200;
const INSTANCE_PAGE_SIZE = 200;

/**
 * One page of an Instance's *eligible* Observations, trimmed to the scoring
 * fields. The `enrichmentStatus === "completed"` half of the rule is served
 * by `by_instance_enrichment_status` as an index equality clause rather than
 * a `.filter()` (per this repo's Convex query guidelines), so a backlog of
 * pending/failed rows is never even read; the remaining clauses (exclusion,
 * selection, lookback, rubric scores present) have no index and are applied
 * in memory over the already-narrowed page.
 *
 * `now` is passed in rather than read here so every page of a single
 * Instance's walk shares one clock — a multi-page sweep that re-read
 * `Date.now()` per page could straddle the lookback boundary mid-walk.
 */
export const listEligibleObservationsPage = internalQuery({
  args: {
    instanceId: v.string(),
    now: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const cutoff = args.now - OBSERVATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    const result = await ctx.db
      .query("sources")
      .withIndex("by_instance_status_capturedAt", (q) =>
        q.eq("instanceId", args.instanceId).eq("status", "ready").gte("capturedAt", cutoff),
      )
      .paginate(args.paginationOpts);

    return {
      page: result.page
        .map((source) => toScorable(source, args.now))
        .filter((scorable): scorable is ScorableObservation => scorable !== undefined)
        .map(toEligibleObservation),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Writes one bounded batch of scores. Only ever patches the two scoring
 * fields, so every ineligible Observation — and every other field of an
 * eligible one — is left completely untouched (issue #487). Recomputed from
 * scratch on every run (no version tracking): the eligible pool's
 * composition shifts day to day, so a stale rank would be wrong far more
 * often than a stale write is a wasted mutation.
 */
export const writeScores = internalMutation({
  args: {
    scores: v.array(
      v.object({
        observationId: v.id("sources"),
        engagementScore: v.number(),
        replicationScore: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const score of args.scores) {
      const source = await ctx.db.get(score.observationId);
      if (!source) continue;
      await ctx.db.patch(score.observationId, {
        scoring: {
          ...source.scoring,
          engagementScore: score.engagementScore,
          replicationScore: score.replicationScore,
        },
      });
    }
  },
});

/** A single Convex `.paginate()` result shape, structurally — what
 * `paginateAll` below drives to completion regardless of which table or
 * index produced it. */
type Page<T> = { page: T[]; isDone: boolean; continueCursor: string };

/** Walks a Convex pagination to completion, feeding each page to `onPage` as
 * it arrives. Both walks in this module (one Instance's Observations, and the
 * Instances themselves) are the same "fetch a page, do something with it,
 * advance the cursor" shape; this is the one place that shape is written —
 * the same helper the removed `insights.ts` carried. */
async function paginateAll<T>(
  fetchPage: (cursor: string | null) => Promise<Page<T>>,
  onPage: (page: T[]) => void,
): Promise<void> {
  let cursor: string | null = null;
  let isDone = false;
  while (!isDone) {
    const result = await fetchPage(cursor);
    onPage(result.page);
    isDone = result.isDone;
    cursor = result.continueCursor;
  }
}

/**
 * Scores one Instance's eligible pool. Percentile ranking is inherently a
 * whole-pool operation — a row's score depends on every peer's — so the walk
 * accumulates the pool (trimmed to the scoring fields, and bounded in
 * practice by the lookback window) in the action before ranking it, then
 * writes the results back in bounded batches. An action, not a mutation, for
 * exactly that reason: no single transaction holds the whole history.
 */
export const scoreEligibleForInstance = internalAction({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const eligible: EligibleObservation[] = [];

    await paginateAll(
      (cursor) =>
        ctx.runQuery(internal.observations_scoring_daily.listEligibleObservationsPage, {
          instanceId: args.instanceId,
          now,
          paginationOpts: { numItems: OBSERVATIONS_PAGE_SIZE, cursor },
        }),
      (page) => {
        for (const observation of page) eligible.push(observation);
      },
    );

    if (eligible.length === 0) return;

    // One result per input, in input order (`computeEngagementScores`), so
    // the two arrays zip by index.
    const engagementScores = computeEngagementScores(eligible);
    const scores = eligible.map((observation, index) => {
      const engagementScore = engagementScores[index].engagementScore;
      return {
        observationId: observation.id,
        engagementScore,
        replicationScore: computeReplicationScore({
          engagementScore,
          productFit: observation.productFit,
          replicability: observation.replicability,
          creativeStrength: observation.creativeStrength,
        }),
      };
    });

    // Each batch touches a disjoint set of Observation ids with no ordering
    // dependency between batches, so they run concurrently rather than
    // waiting on each other one at a time.
    const batches: (typeof scores)[] = [];
    for (let i = 0; i < scores.length; i += SCORE_WRITE_BATCH_SIZE) {
      batches.push(scores.slice(i, i + SCORE_WRITE_BATCH_SIZE));
    }
    await Promise.all(
      batches.map((batch) =>
        ctx.runMutation(internal.observations_scoring_daily.writeScores, { scores: batch }),
      ),
    );

    // Production is created by the generic source_routing Job after its Agent
    // Run proposes a validated target. Scoring only returns the winner here;
    // it never creates a technical routing Mission.
    return pickTopEligible(
      scores.map((score) => ({ id: score.observationId, replicationScore: score.replicationScore })),
    )?.id;
  },
});

/**
 * One page of Instances, walked via the existing `by_updated_at` index (no
 * equality filter — every Instance is wanted). Cron fan-out glue, matching
 * the removed `insights.listInstancePage` precedent exactly — not part of
 * the public API, not separately unit-tested (crons.ts's own no-test
 * precedent for job-wiring code).
 *
 * Reads the `instances` table directly rather than re-deriving "which
 * Instances exist" from `observations` — `instances` is the actual source of
 * Instance identity, and is far smaller than the ever-growing Observation
 * log.
 */
export const listInstancePage = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("instances")
      .withIndex("by_updated_at")
      .paginate(args.paginationOpts);

    // `openclawId` is unset until an Instance finishes provisioning
    // (schema.ts) — it can own no Observations yet.
    const instanceIds = result.page
      .map((instance) => instance.openclawId)
      .filter((openclawId): openclawId is string => openclawId !== undefined);

    return { page: instanceIds, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

/**
 * Fans `scoreEligibleForInstance` out over every provisioned Instance (issue
 * #487) — the same "list all X, act per X, don't let one X's failure abort
 * the rest" shape the removed `insights.consolidateAll` used. Registered as
 * a daily cron in crons.ts, taking over the slot the removed
 * `insights-consolidation` job vacated (issue #485).
 */
export const scoreEligibleAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const instanceIds = new Set<string>();
    await paginateAll(
      (cursor) =>
        ctx.runQuery(internal.observations_scoring_daily.listInstancePage, {
          paginationOpts: { numItems: INSTANCE_PAGE_SIZE, cursor },
        }),
      (page) => {
        for (const instanceId of page) instanceIds.add(instanceId);
      },
    );

    await Promise.all(Array.from(instanceIds, (instanceId) => scoreOneInstance(ctx, instanceId)));
  },
});

/** `scoreEligibleForInstance`, with a failure logged and swallowed rather
 * than thrown — so one Instance's failure can't abort the sweep over the
 * rest. Nothing on an Observation records the failure; the next daily run
 * recomputes wholesale anyway. */
async function scoreOneInstance(ctx: ActionCtx, instanceId: string): Promise<void> {
  try {
    await ctx.runAction(internal.observations_scoring_daily.scoreEligibleForInstance, {
      instanceId,
    });
  } catch (err) {
    console.error(
      `observations_scoring_daily.scoreEligibleAll failed for instance ${instanceId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}
