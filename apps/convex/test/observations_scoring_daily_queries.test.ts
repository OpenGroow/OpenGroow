import { insertInstance } from "./instance_fixture";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../_generated/api";
import schema from "../schema";
import { insertObservationAsSource, type ObservationFixture } from "./helpers/observation_source";
import type { Id } from "../_generated/dataModel";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../commands.ts": () => import("../commands.js"),
  "../commands_node.ts": () => import("../commands_node.js"),
  "../connect_tickets.ts": () => import("../connect_tickets.js"),
  "../connect_tickets_node.ts": () => import("../connect_tickets_node.js"),
  "../events.ts": () => import("../events.js"),
  "../health.ts": () => import("../health.js"),
  "../http.ts": () => import("../http.js"),
  "../instances.ts": () => import("../instances.js"),
  "../instances_node.ts": () => import("../instances_node.js"),
  "../missions.ts": () => import("../missions.js"),
  "../runs.ts": () => import("../runs.js"),
  "../observations_scoring_daily.ts": () => import("../observations_scoring_daily.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../project_agents_node.ts": () => import("../project_agents_node.js"),
  "../runtime_commands_node.ts": () => import("../runtime_commands_node.js"),
};

const INSTANCE_ID = "openclaw-instance-daily-score";
const OWNER = {
  name: "Owner",
  email: "owner@example.com",
  tokenIdentifier: "test|owner-daily-score",
  subject: "owner-daily-score",
};

const DAY_MS = 24 * 60 * 60 * 1000;

async function seedInstance(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, {
      jobId: `job-${INSTANCE_ID}`,
      status: "running",
      createdAt: now,
      openclawId: INSTANCE_ID,
      updatedAt: now,
      userId: OWNER.subject,
    });

    const missionId = await ctx.db.insert("missions", {
      ownerId: OWNER.subject,
      instanceId: INSTANCE_ID,
      templateId: "@opengroow/engagement",
      type: "engage",
      payload: { platform: "instagram" },
      status: "doing",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const runId = await ctx.db.insert("runs", {
      missionId,
      ownerId: OWNER.subject,
      instanceId: INSTANCE_ID,
      templateId: "@opengroow/engagement",
      agentName: "engagement",
      sessionKey: `mega-mission-${missionId}`,
      status: "completed",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { missionId, runId };
  });
}

type ObservationOverrides = Partial<{
  postUrl: string;
  capturedAt: number;
  enrichmentStatus: ObservationFixture["enrichmentStatus"];
  excluded: boolean;
  selectedAt: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  saveCount: number;
  rawEngagementScore: number;
  productFit: 0 | 0.25 | 0.5 | 0.75 | 1;
  replicability: 0 | 0.25 | 0.5 | 0.75 | 1;
  creativeStrength: 0 | 0.25 | 0.5 | 0.75 | 1;
}>;

async function insertObservation(
  t: ReturnType<typeof convexTest>,
  missionId: Id<"missions">,
  runId: Id<"runs">,
  overrides: ObservationOverrides,
) {
  return await t.run(async (ctx) => {
    return await insertObservationAsSource(ctx, {
      ownerId: OWNER.subject,
      instanceId: INSTANCE_ID,
      missionId,
      runId,
      platform: "instagram" as const,
      sourceAccount: "@brand",
      description: "Great hook",
      postUrl: overrides.postUrl ?? "https://www.instagram.com/reel/abc123/",
      capturedAt: overrides.capturedAt ?? Date.now(),
      createdAt: Date.now(),
      enrichmentStatus: overrides.enrichmentStatus ?? "completed",
      excluded: overrides.excluded ?? false,
      selectedAt: overrides.selectedAt,
      viewCount: overrides.viewCount,
      likeCount: overrides.likeCount,
      commentCount: overrides.commentCount,
      shareCount: overrides.shareCount,
      saveCount: overrides.saveCount,
      rawEngagementScore: overrides.rawEngagementScore,
      productFit: overrides.productFit ?? 0.5,
      replicability: overrides.replicability ?? 0.5,
      creativeStrength: overrides.creativeStrength ?? 0.5,
    });
  });
}

describe("observations_scoring_daily.scoreEligibleForInstance", () => {
  it("scores every eligible Observation across both groups and leaves ineligible ones untouched", async () => {
    const t = convexTest(schema, modules);
    const { missionId, runId } = await seedInstance(t);
    const now = Date.now();

    // Group B (viewCount unknown), 5 eligible members so ranking actually
    // computes instead of falling back to the flat 0.5.
    const eligibleIds = [] as Id<"sources">[];
    for (const rawEngagementScore of [0, 10, 100, 1000, 10000]) {
      eligibleIds.push(
        await insertObservation(t, missionId, runId, {
          postUrl: `https://www.instagram.com/reel/b-${rawEngagementScore}/`,
          rawEngagementScore,
        }),
      );
    }

    // Group A (viewCount known), also 5 members, ranked on the weighted rate
    // over the same view count — and ranked entirely separately from Group B
    // above, whose raw counts dwarf these likes.
    const groupAIds = [] as Id<"sources">[];
    for (const likeCount of [1, 2, 3, 4, 5]) {
      groupAIds.push(
        await insertObservation(t, missionId, runId, {
          postUrl: `https://www.instagram.com/reel/a-${likeCount}/`,
          viewCount: 1000,
          likeCount,
          rawEngagementScore: likeCount,
        }),
      );
    }
    eligibleIds.push(...groupAIds);

    // Ineligible: excluded.
    const excludedId = await insertObservation(t, missionId, runId, {
      postUrl: "https://www.instagram.com/reel/excluded/",
      rawEngagementScore: 50,
      excluded: true,
    });
    // Ineligible: already selected.
    const selectedId = await insertObservation(t, missionId, runId, {
      postUrl: "https://www.instagram.com/reel/selected/",
      rawEngagementScore: 50,
      selectedAt: now,
    });
    // Ineligible: outside the lookback window.
    const staleId = await insertObservation(t, missionId, runId, {
      postUrl: "https://www.instagram.com/reel/stale/",
      rawEngagementScore: 50,
      capturedAt: now - 8 * DAY_MS,
    });
    // Ineligible: not deep-enriched.
    const pendingId = await insertObservation(t, missionId, runId, {
      postUrl: "https://www.instagram.com/reel/pending/",
      rawEngagementScore: 50,
      enrichmentStatus: "pending",
    });

    await t.action(internal.observations_scoring_daily.scoreEligibleForInstance, {
      instanceId: INSTANCE_ID,
    });

    const scored = await t.run(async (ctx) => {
      const rows = [];
      for (const id of eligibleIds) rows.push(await ctx.db.get(id));
      return rows;
    });
    for (const row of scored) {
      expect(row?.scoring?.engagementScore).toBeTypeOf("number");
      expect(row?.scoring?.replicationScore).toBeTypeOf("number");
    }
    // The highest rawEngagementScore in Group B lands at percentile 1.
    const highest = scored.find(
      (r) => r !== null && r.analysis.viewCount === undefined && r.scoring?.rawEngagementScore === 10000,
    );
    expect(highest?.scoring?.engagementScore).toBeCloseTo(1);
    const lowest = scored.find(
      (r) => r !== null && r.analysis.viewCount === undefined && r.scoring?.rawEngagementScore === 0,
    );
    expect(lowest?.scoring?.engagementScore).toBeCloseTo(0);

    // Group A is ranked on its own scale: its best row also reaches 1 and its
    // worst 0, even though every one of its raw counts is far below Group B's.
    const bestA = await t.run(async (ctx) => ctx.db.get(groupAIds[4]));
    const worstA = await t.run(async (ctx) => ctx.db.get(groupAIds[0]));
    expect(bestA?.scoring?.engagementScore).toBeCloseTo(1);
    expect(worstA?.scoring?.engagementScore).toBeCloseTo(0);
    // replicationScore = engagement*.40 + (.5 productFit + .5 replicability +
    // .5 creativeStrength weighted .25/.20/.15) = engagement*.40 + .30
    expect(bestA?.scoring?.replicationScore).toBeCloseTo(0.7);
    expect(worstA?.scoring?.replicationScore).toBeCloseTo(0.3);

    const untouched = await t.run(async (ctx) => {
      return {
        excluded: await ctx.db.get(excludedId),
        selected: await ctx.db.get(selectedId),
        stale: await ctx.db.get(staleId),
        pending: await ctx.db.get(pendingId),
      };
    });
    expect(untouched.excluded?.scoring?.engagementScore).toBeUndefined();
    expect(untouched.excluded?.scoring?.replicationScore).toBeUndefined();
    expect(untouched.selected?.scoring?.engagementScore).toBeUndefined();
    expect(untouched.stale?.scoring?.engagementScore).toBeUndefined();
    expect(untouched.pending?.scoring?.engagementScore).toBeUndefined();
  });

  it("gives every member a flat 0.5 engagementScore for a group smaller than MIN_GROUP_SIZE_FOR_PERCENTILE", async () => {
    const t = convexTest(schema, modules);
    const { missionId, runId } = await seedInstance(t);

    const smallGroupIds = [] as Id<"sources">[];
    for (const rawEngagementScore of [5, 500]) {
      smallGroupIds.push(
        await insertObservation(t, missionId, runId, {
          postUrl: `https://www.instagram.com/reel/small-${rawEngagementScore}/`,
          rawEngagementScore,
        }),
      );
    }

    await t.action(internal.observations_scoring_daily.scoreEligibleForInstance, {
      instanceId: INSTANCE_ID,
    });

    const rows = await t.run(async (ctx) => {
      const out = [];
      for (const id of smallGroupIds) out.push(await ctx.db.get(id));
      return out;
    });
    for (const row of rows) {
      expect(row?.scoring?.engagementScore).toBe(0.5);
    }
  });
});

describe("observations_scoring_daily.scoreEligibleAll", () => {
  it("fans out across every provisioned Instance, skipping unprovisioned ones", async () => {
    const t = convexTest(schema, modules);
    const { missionId, runId } = await seedInstance(t);

    // Still provisioning: no `openclawId`, so it owns no Observations and
    // must be skipped rather than crash the sweep.
    await t.run(async (ctx) => {
      const now = new Date().toISOString();
      await insertInstance(ctx, {
        jobId: "job-unprovisioned",
        status: "queued",
        createdAt: now,
        updatedAt: now,
        userId: OWNER.subject,
      });
    });

    const id = await insertObservation(t, missionId, runId, {
      postUrl: "https://www.instagram.com/reel/fanout/",
      rawEngagementScore: 42,
    });

    await t.action(internal.observations_scoring_daily.scoreEligibleAll, {});

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.scoring?.engagementScore).toBe(0.5); // single-member Group B
    expect(row?.scoring?.replicationScore).toBeTypeOf("number");
  });
});
