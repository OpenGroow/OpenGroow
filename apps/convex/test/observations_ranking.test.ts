import { describe, expect, it } from "vitest";
import {
  computeEngagementScores,
  computeReplicationScore,
  MIN_REPLICATION_SCORE,
  pickTopEligible,
} from "../observations_ranking";

describe("computeEngagementScores", () => {
  it("percentile-ranks Group A (viewCount known) by the weighted engagement rate", () => {
    // Five rows, viewCount known on all five — a single Group A at exactly
    // MIN_GROUP_SIZE_FOR_PERCENTILE, so ranking actually computes instead of
    // falling back to the flat 0.5. Only likeRate is non-zero, to keep the
    // expected rate arithmetic legible: rate = .15 * likes / views.
    const rows = [
      { id: "lower", viewCount: 1000, likeCount: 5, commentCount: 0, shareCount: 0, saveCount: 0 },
      { id: "low", viewCount: 1000, likeCount: 10, commentCount: 0, shareCount: 0, saveCount: 0 },
      { id: "mid", viewCount: 1000, likeCount: 50, commentCount: 0, shareCount: 0, saveCount: 0 },
      { id: "high", viewCount: 1000, likeCount: 100, commentCount: 0, shareCount: 0, saveCount: 0 },
      {
        id: "highest",
        viewCount: 1000,
        likeCount: 200,
        commentCount: 0,
        shareCount: 0,
        saveCount: 0,
      },
    ];

    const result = computeEngagementScores(rows);
    const byId = new Map(result.map((r) => [r.id, r.engagementScore]));

    // Ascending rate order: lower(.00075) < low(.0015) < mid(.0075) <
    // high(.015) < highest(.03) -> ranks 0, .25, .5, .75, 1 (5 items, rank/(n-1)).
    expect(byId.get("lower")).toBeCloseTo(0);
    expect(byId.get("low")).toBeCloseTo(0.25);
    expect(byId.get("mid")).toBeCloseTo(0.5);
    expect(byId.get("high")).toBeCloseTo(0.75);
    expect(byId.get("highest")).toBeCloseTo(1);
  });

  it("weights Group A's rate .15 likes / .20 comments / .35 shares / .30 saves", () => {
    // One row per signal, each with the same raw count over the same views,
    // so the ranking order is exactly the weight order.
    const rows = [
      { id: "likes", viewCount: 100, likeCount: 10 },
      { id: "comments", viewCount: 100, commentCount: 10 },
      { id: "saves", viewCount: 100, saveCount: 10 },
      { id: "shares", viewCount: 100, shareCount: 10 },
      { id: "none", viewCount: 100 },
    ];

    const byId = new Map(computeEngagementScores(rows).map((r) => [r.id, r.engagementScore]));

    // Missing counts count as 0, so "none" has the lowest rate of all.
    expect(byId.get("none")).toBeCloseTo(0);
    expect(byId.get("likes")).toBeCloseTo(0.25);
    expect(byId.get("comments")).toBeCloseTo(0.5);
    expect(byId.get("saves")).toBeCloseTo(0.75);
    expect(byId.get("shares")).toBeCloseTo(1);
  });

  it("percentile-ranks Group B (viewCount unknown) by log1p(rawEngagementScore), never mixing with Group A", () => {
    const rows = [
      // Group A: viewCount known. Would rank very differently if mixed with
      // Group B, proving groups stay separate.
      { id: "a1", viewCount: 1000, likeCount: 900, commentCount: 0, shareCount: 0, saveCount: 0 },
      { id: "a2", viewCount: 1000, likeCount: 1, commentCount: 0, shareCount: 0, saveCount: 0 },
      { id: "a3", viewCount: 1000, likeCount: 1, commentCount: 0, shareCount: 0, saveCount: 0 },
      { id: "a4", viewCount: 1000, likeCount: 1, commentCount: 0, shareCount: 0, saveCount: 0 },
      { id: "a5", viewCount: 1000, likeCount: 1, commentCount: 0, shareCount: 0, saveCount: 0 },
      // Group B: viewCount unknown, ranked by log1p(rawEngagementScore).
      { id: "b1", rawEngagementScore: 0 },
      { id: "b2", rawEngagementScore: 10 },
      { id: "b3", rawEngagementScore: 100 },
      { id: "b4", rawEngagementScore: 1000 },
      { id: "b5", rawEngagementScore: 10000 },
    ];

    const result = computeEngagementScores(rows);
    const byId = new Map(result.map((r) => [r.id, r.engagementScore]));

    expect(byId.get("b1")).toBeCloseTo(0);
    expect(byId.get("b2")).toBeCloseTo(0.25);
    expect(byId.get("b3")).toBeCloseTo(0.5);
    expect(byId.get("b4")).toBeCloseTo(0.75);
    expect(byId.get("b5")).toBeCloseTo(1);

    // Group A's own ranking is untouched by Group B's presence.
    expect(byId.get("a1")).toBeCloseTo(1);
  });

  it("ranks a zero viewCount in Group B rather than dividing by it", () => {
    // `observations.optionalNumber` stores a literal 0 whenever the report
    // carries `viewCount: 0`, so this row really does reach the ranker. It
    // must not land in Group A: `x / 0` is NaN/Infinity, which would poison
    // Group A's sort comparator for every other member.
    const rows = [
      { id: "zeroViews", viewCount: 0, likeCount: 7, rawEngagementScore: 7 },
      { id: "b1", rawEngagementScore: 0 },
      { id: "b2", rawEngagementScore: 10 },
      { id: "b3", rawEngagementScore: 100 },
      { id: "b4", rawEngagementScore: 1000 },
    ];

    const byId = new Map(computeEngagementScores(rows).map((r) => [r.id, r.engagementScore]));

    for (const score of byId.values()) expect(Number.isFinite(score)).toBe(true);
    // log1p(7) sits between log1p(0) and log1p(10): second-lowest of five.
    expect(byId.get("b1")).toBeCloseTo(0);
    expect(byId.get("zeroViews")).toBeCloseTo(0.25);
    expect(byId.get("b2")).toBeCloseTo(0.5);
  });

  it("gives tied values the same rank — that of the first index in the tie", () => {
    const rows = [
      { id: "t1", rawEngagementScore: 10 },
      { id: "t2", rawEngagementScore: 10 },
      { id: "t3", rawEngagementScore: 10 },
      { id: "hi1", rawEngagementScore: 100 },
      { id: "hi2", rawEngagementScore: 1000 },
    ];

    const byId = new Map(computeEngagementScores(rows).map((r) => [r.id, r.engagementScore]));

    // The three tied rows occupy sorted positions 0..2 and all take rank 0.
    expect(byId.get("t1")).toBeCloseTo(0);
    expect(byId.get("t2")).toBeCloseTo(0);
    expect(byId.get("t3")).toBeCloseTo(0);
    expect(byId.get("hi1")).toBeCloseTo(0.75);
    expect(byId.get("hi2")).toBeCloseTo(1);
  });

  it("gives every member a flat 0.5 when a group has fewer than MIN_GROUP_SIZE_FOR_PERCENTILE members", () => {
    const rows = [
      { id: "a1", viewCount: 1000, likeCount: 10, commentCount: 0, shareCount: 0, saveCount: 0 },
      { id: "a2", viewCount: 1000, likeCount: 999, commentCount: 0, shareCount: 0, saveCount: 0 },
      { id: "a3", viewCount: 1000, likeCount: 1, commentCount: 0, shareCount: 0, saveCount: 0 },
      { id: "a4", viewCount: 1000, likeCount: 500, commentCount: 0, shareCount: 0, saveCount: 0 },
    ];

    const result = computeEngagementScores(rows);
    for (const r of result) {
      expect(r.engagementScore).toBe(0.5);
    }
  });

  it("returns 0.5 for a single-member group (no spread to rank against)", () => {
    const result = computeEngagementScores([{ id: "only", rawEngagementScore: 42 }]);
    expect(result).toEqual([{ id: "only", engagementScore: 0.5 }]);
  });

  it("returns one result per input, in input order", () => {
    const rows = [
      { id: "b1", rawEngagementScore: 1000 },
      { id: "a1", viewCount: 100, likeCount: 1 },
      { id: "b2", rawEngagementScore: 0 },
    ];

    expect(computeEngagementScores(rows).map((r) => r.id)).toEqual(["b1", "a1", "b2"]);
  });

  it("returns an empty array for an empty pool", () => {
    expect(computeEngagementScores([])).toEqual([]);
  });
});

describe("computeReplicationScore", () => {
  it("weights engagementScore .40, productFit .25, replicability .20, creativeStrength .15", () => {
    // Worked by hand: .8*.40 + 1*.25 + .5*.20 + 0*.15 = .32 + .25 + .10 + 0 = .67
    const score = computeReplicationScore({
      engagementScore: 0.8,
      productFit: 1,
      replicability: 0.5,
      creativeStrength: 0,
    });
    expect(score).toBeCloseTo(0.67);
  });

  it("returns 0 when every input is 0", () => {
    expect(
      computeReplicationScore({
        engagementScore: 0,
        productFit: 0,
        replicability: 0,
        creativeStrength: 0,
      }),
    ).toBe(0);
  });

  it("returns 1 when every input is 1 (weights sum to 1)", () => {
    expect(
      computeReplicationScore({
        engagementScore: 1,
        productFit: 1,
        replicability: 1,
        creativeStrength: 1,
      }),
    ).toBeCloseTo(1);
  });
});

describe("pickTopEligible (issue #488)", () => {
  it("picks the strict-highest-scoring candidate", () => {
    const candidates = [
      { id: "low", replicationScore: 0.72 },
      { id: "winner", replicationScore: 0.91 },
      { id: "mid", replicationScore: 0.8 },
    ];
    expect(pickTopEligible(candidates)).toEqual({ id: "winner", replicationScore: 0.91 });
  });

  it("returns null when the top score is below MIN_REPLICATION_SCORE (0.70)", () => {
    expect(MIN_REPLICATION_SCORE).toBe(0.7);
    const candidates = [
      { id: "a", replicationScore: 0.69 },
      { id: "b", replicationScore: 0.5 },
    ];
    expect(pickTopEligible(candidates)).toBeNull();
  });

  it("picks a candidate whose score exactly equals MIN_REPLICATION_SCORE (inclusive threshold)", () => {
    const candidates = [{ id: "exact", replicationScore: 0.7 }];
    expect(pickTopEligible(candidates)).toEqual({ id: "exact", replicationScore: 0.7 });
  });

  it("returns null for an empty pool", () => {
    expect(pickTopEligible([])).toBeNull();
  });

  it("breaks ties by picking the first candidate at the top score, in input order", () => {
    const candidates = [
      { id: "first", replicationScore: 0.9 },
      { id: "second", replicationScore: 0.9 },
    ];
    expect(pickTopEligible(candidates)).toEqual({ id: "first", replicationScore: 0.9 });
  });
});
