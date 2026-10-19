import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { ownerIdFor, readOwnerId } from "./instance_ownership.js";
import { indexingOutcomeV } from "./indexing.js";
import { findLiveRunForMission } from "./runs.js";
import { currentTemplateVersion } from "./template_registry.js";

// Inserts a pending Run for a mission against its active projectAgent. Shared by
// `create` (initial run) and `rejectMission` (revision run with feedback) so the
// projectAgent resolution and session-key handshake stay in one place.
async function dispatchRun(
  ctx: MutationCtx,
  args: {
    mission: Pick<Doc<"missions">, "_id" | "instanceId" | "templateId">;
    ownerId: string;
    humanFeedback?: string;
  },
): Promise<Id<"runs">> {
  const { mission, ownerId, humanFeedback } = args;

  const projectAgent = await ctx.db
    .query("projectAgents")
    .withIndex("by_instance_template", (q) =>
      q.eq("instanceId", mission.instanceId).eq("templateId", mission.templateId),
    )
    .unique();
  if (!projectAgent || projectAgent.status !== "active") {
    throw new Error(`projectAgent for ${mission.templateId} is not active`);
  }
  const openclawAgentName = projectAgent.openclawAgentName;
  if (!openclawAgentName) {
    throw new Error("projectAgent has no openclawAgentName");
  }

  const now = Date.now();
  const runId = await ctx.db.insert("runs", {
    missionId: mission._id,
    ownerId,
    instanceId: mission.instanceId,
    templateId: mission.templateId,
    agentName: openclawAgentName,
    // Placeholder — patched below with the runId-based key.
    sessionKey: "",
    ...(humanFeedback !== undefined ? { humanFeedback } : {}),
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });
  // Each run gets its own openclaw session for a clean context.
  // Inter-run continuity is handled via workspace files (context.md, outputs/).
  await ctx.db.patch(runId, { sessionKey: `mega-run-${runId}` });

  return runId;
}

// Atomically increments the mission counter for the project and returns the next number.
async function nextMissionNumber(ctx: MutationCtx, instanceId: string): Promise<number> {
  const counter = await ctx.db
    .query("projectCounters")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .unique();
  if (counter) {
    const next = counter.missionCount + 1;
    await ctx.db.patch(counter._id, { missionCount: next });
    return next;
  }
  await ctx.db.insert("projectCounters", { instanceId, missionCount: 1 });
  return 1;
}

// Inserts a Mission (todo) and dispatches its initial Run (pending) for a known
// owner. The single creation path shared by the public `create` (UI, owner via
// ctx.auth) and `createForOwner` (Schedule tick, owner passed in). `name` is
// written only when the caller provides a non-undefined value — the manual
// `create` handler pre-fills a derived default before calling here, while the
// Schedule tick passes no `name` so scheduled missions remain name-less (the
// board displays `summary ?? name`, so a missing name is fine).
// `dispatchRun` remains the only dispatch path. Exported so callers that
// need the create-and-dispatch step to commit in their own transaction
// (rather than nesting a `ctx.runMutation(internal.missions.createForOwner)`
// call) can invoke it directly.
export async function insertMissionAndDispatch(
  ctx: MutationCtx,
  args: {
    ownerId: string;
    instanceId: string;
    templateId: string;
    type: string;
    payload: unknown;
    name?: string;
    autoPublish?: boolean;
    sourceObservationId?: Id<"sources">;
  },
): Promise<{ missionId: Id<"missions">; runId: Id<"runs"> }> {
  const number = await nextMissionNumber(ctx, args.instanceId);
  const now = Date.now();
  const missionId = await ctx.db.insert("missions", {
    ownerId: args.ownerId,
    instanceId: args.instanceId,
    templateId: args.templateId,
    templateVersion: await currentTemplateVersion(ctx, args.instanceId, args.templateId),
    type: args.type,
    payload: args.payload,
    status: "todo",
    number,
    ...(args.name !== undefined ? { name: args.name } : {}),
    ...(args.autoPublish !== undefined ? { autoPublish: args.autoPublish } : {}),
    ...(args.sourceObservationId !== undefined
      ? { sourceObservationId: args.sourceObservationId }
      : {}),
    createdAt: now,
    updatedAt: now,
  });

  const runId = await dispatchRun(ctx, {
    mission: { _id: missionId, instanceId: args.instanceId, templateId: args.templateId },
    ownerId: args.ownerId,
  });

  return { missionId, runId };
}

export const create = mutation({
  args: {
    instanceId: v.string(),
    templateId: v.string(),
    type: v.string(),
    payload: v.any(),
    name: v.optional(v.string()),
    autoPublish: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ownerId = await ownerIdFor(ctx, args.instanceId);
    // When the user leaves the name field empty or whitespace-only, derive a
    // default from the mission type and the per-project sequential number
    // (e.g. "create_article #14") so the board always has a readable label.
    // We peek the counter here (read-only) to predict the next number;
    // `insertMissionAndDispatch` increments it atomically — both operations
    // run in the same mutation transaction so the number is consistent.
    // This default-name logic lives ONLY in this handler so scheduled missions
    // (createForOwner) are never affected by it.
    const trimmed = args.name?.trim() || undefined;
    const currentCounter = await ctx.db
      .query("projectCounters")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .unique();
    const nextNumber = (currentCounter?.missionCount ?? 0) + 1;
    const name = trimmed ?? `${args.type} #${nextNumber}`;
    return await insertMissionAndDispatch(ctx, { ...args, name, ownerId });
  },
});

// Owner-scoped creation without ctx.auth, for callers that already resolved the
// owner (the Schedule tick). Skips the identity handshake and the manual
// default-name derivation — scheduled missions are stored without a name unless
// the caller explicitly provides one.
export const createForOwner = internalMutation({
  args: {
    ownerId: v.string(),
    instanceId: v.string(),
    templateId: v.string(),
    type: v.string(),
    payload: v.any(),
    name: v.optional(v.string()),
    autoPublish: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await insertMissionAndDispatch(ctx, args);
  },
});

export const get = query({
  args: { missionId: v.id("missions") },
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) return null;
    const ownerId = await readOwnerId(ctx, mission.instanceId);
    if (ownerId !== mission.ownerId) return null;
    return mission;
  },
});

export const getByIdInternal = internalQuery({
  args: { missionId: v.id("missions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.missionId);
  },
});

export const markApproved = internalMutation({
  args: { missionId: v.id("missions") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.missionId, { status: "approved", updatedAt: Date.now() });
  },
});

/**
 * Generic rejection: creates a revision Run with human feedback and moves the
 * Mission back to "doing". Called by `performReviewAction` when `actionKey === "reject"`.
 * This is the durable generic reject path used by `performReviewAction`.
 *
 * @returns The new Run's id.
 */
export const rejectMission = internalMutation({
  args: {
    missionId: v.id("missions"),
    ownerId: v.string(),
    feedback: v.string(),
    eventType: v.string(),
  },
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found");

    const runId = await dispatchRun(ctx, {
      mission,
      ownerId: args.ownerId,
      humanFeedback: args.feedback,
    });

    const now = Date.now();
    await ctx.db.patch(args.missionId, { status: "doing", updatedAt: now });

    await ctx.runMutation(internal.events.store, {
      instanceId: mission.instanceId,
      event: {
        id: `${args.eventType}:${args.missionId}:${runId}`,
        type: args.eventType,
        payload: { missionId: args.missionId, feedback: args.feedback },
        ts: now,
      },
    });

    return { runId };
  },
});

/**
 * An Intermediate External Job (ADR-026) completed. Writes the Intermediate
 * Result onto the Mission (replacing any previous one — never accumulated)
 * and creates a new `pending` Run for the same Mission. Unlike `rejectMission`,
 * the Mission's status is left untouched (it stays `doing`): no `RunResult`
 * was produced, so no board transition is triggered. Called by
 * `mission_dispatcher_node.ts` when `decideExternalJobPoll` returns
 * `markResumed`.
 *
 * @returns The new Run's id.
 */
/**
 * Atomically re-validates Stop's eligibility and reserves cancellation
 * intent (issue #482 review fix): re-reads the Mission's status and its live
 * Run *in the same mutation* that sets `cancelling`, instead of
 * `missions_node.cancelMission` trusting its separate, slightly-earlier
 * `getByIdInternal` read, which it uses only for the fail-fast/ownership
 * check.
 *
 * Without this, a reconciliation tick's `resumeMission` could land in the
 * gap between that earlier read and `cancelling` actually being persisted:
 * it would see `cancelling` still false, dispatch a fresh Run, and demote
 * the originally-read Run to `resumed` — so the kill command and the eventual
 * `runs.markCancelled` would target a Run that is no longer live, silently
 * leaving the new Run to keep burning quota while Stop still reports success.
 * Folding the read and the flag-set into one transaction means any concurrent
 * `resumeMission` either fully commits first (and this mutation then reserves
 * cancellation against *its* resulting live Run) or is blocked by `cancelling`
 * once this mutation commits — never both racing against a stale reference.
 *
 * @returns The live Run to target, or null if the Mission is no longer
 * eligible (not `doing`, or no live Run) by the time this mutation runs.
 */
export const reserveCancellation = internalMutation({
  args: { missionId: v.id("missions") },
  handler: async (ctx, args): Promise<Doc<"runs"> | null> => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found");
    if (mission.status !== "doing") return null;
    const liveRun = await findLiveRunForMission(ctx, args.missionId);
    if (!liveRun) return null;
    await ctx.db.patch(args.missionId, { cancelling: true, updatedAt: Date.now() });
    return liveRun;
  },
});

export const resumeMission = internalMutation({
  args: {
    missionId: v.id("missions"),
    intermediateResult: v.any(),
  },
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found");
    // An operator stopped this Mission (issue #482), or a Stop is currently
    // in flight (`cancelling`, set before the gateway kill/wait round-trip
    // by `missions_node.cancelMission`). `runs.markResumed` already no-ops on
    // the cancelled Run, but this Mission-side half runs as a separate
    // mutation — without this guard it would dispatch a brand-new Run for a
    // Mission the operator just stopped (or is in the process of stopping),
    // which is exactly the quota burn Stop exists to end.
    if (mission.status === "cancelled" || mission.cancelling === true) return { runId: null };

    const runId = await dispatchRun(ctx, {
      mission,
      ownerId: mission.ownerId,
    });

    await ctx.db.patch(args.missionId, {
      lastIntermediateResult: args.intermediateResult,
      updatedAt: Date.now(),
    });

    return { runId };
  },
});

/**
 * A retryable External Job failure (`onFail: "resume_mission"` — extends
 * ADR-026 to the failure path). Like `resumeMission`, creates a new `pending`
 * Run for the same Mission and leaves the Mission's status untouched (still
 * `doing`) — but records the error under `lastRetryableFailure` instead of
 * `lastIntermediateResult`, so context.md (mission_context.ts) can surface it
 * distinctly as "this failed, fix it" rather than as ADR-026's non-terminal
 * success value. Increments `retryableFailureCount`, which
 * `decideExternalJobPoll` checks against `MAX_RETRYABLE_JOB_FAILURES` before
 * choosing this path again — called by `mission_dispatcher_node.ts` when
 * `decideExternalJobPoll` returns `markFailedRetryable`.
 *
 * @returns The new Run's id.
 */
export const resumeMissionAfterRetryableFailure = internalMutation({
  args: {
    missionId: v.id("missions"),
    jobType: v.optional(v.string()),
    error: v.string(),
    details: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found");
    // See resumeMission: never dispatch a new Run for a Mission an operator
    // stopped, or is in the process of stopping (issue #482).
    if (mission.status === "cancelled" || mission.cancelling === true) return { runId: null };

    const runId = await dispatchRun(ctx, {
      mission,
      ownerId: mission.ownerId,
    });

    await ctx.db.patch(args.missionId, {
      lastRetryableFailure: {
        jobType: args.jobType,
        error: args.error,
        ...(args.details !== undefined ? { details: args.details } : {}),
      },
      retryableFailureCount: (mission.retryableFailureCount ?? 0) + 1,
      updatedAt: Date.now(),
    });

    return { runId };
  },
});

export const retryMission = mutation({
  args: {
    missionId: v.id("missions"),
    sourceRunId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found");

    // Ownership check — same pattern as deleteMission.
    const ownerId = await ownerIdFor(ctx, mission.instanceId);
    if (mission.ownerId !== ownerId) throw new Error("Forbidden");

    if (mission.status !== "failed" && mission.status !== "blocked") {
      throw new Error(
        "Mission is not failed or blocked — only failed or blocked missions can be retried",
      );
    }

    // Inherit humanFeedback from the source run if present.
    const sourceRun = await ctx.db.get(args.sourceRunId);
    if (sourceRun && sourceRun.missionId !== args.missionId) {
      throw new Error("sourceRun does not belong to this mission");
    }
    const humanFeedback = sourceRun?.humanFeedback;

    const runId = await dispatchRun(ctx, {
      mission,
      ownerId,
      ...(humanFeedback !== undefined ? { humanFeedback } : {}),
    });

    await ctx.db.patch(args.missionId, { status: "doing", updatedAt: Date.now() });

    return { runId };
  },
});

// Toggles `autoPublish` on an existing Mission. Reversible only while the
// Mission hasn't finished its Run — the actual auto-chaining trigger
// (issue #329) is immediate once a Run completes, so there is never an
// observable in-between state where reverting after that point would matter
// (see PRD #326, "Réversibilité").
export const setAutoPublish = mutation({
  args: {
    missionId: v.id("missions"),
    autoPublish: v.boolean(),
  },
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found");

    const ownerId = await ownerIdFor(ctx, mission.instanceId);
    if (mission.ownerId !== ownerId) throw new Error("Forbidden");

    if (mission.status !== "todo" && mission.status !== "doing") {
      throw new Error(
        `autoPublish can only be changed while the Mission is "todo" or "doing", got: "${mission.status}"`,
      );
    }

    await ctx.db.patch(args.missionId, { autoPublish: args.autoPublish, updatedAt: Date.now() });
  },
});

/**
 * Marks a Mission `failed` with an explicit error message, without touching
 * any Run. Distinct from `runs.markFailed` (which also fails the Run
 * itself): this is used by the auto-publish chain (issue #329), triggered
 * after the Run has already completed successfully in `needs_human_review`
 * — only the Mission's post-completion automation (approve/publish
 * chaining) failed, so there is no Run to fail alongside it.
 *
 * Only applies from `to_validate`/`approved` — the chain's own in-progress
 * states. A concurrent human `performReviewAction` can race the chain and
 * finish the Mission (`approved` -> `done`) before a stale `approve`/
 * `publish` step throws; without this guard, that late failure would
 * silently regress an already-terminal Mission back to `failed`.
 */
export const markFailed = internalMutation({
  args: { missionId: v.id("missions"), errorMessage: v.string() },
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found");
    if (mission.status !== "to_validate" && mission.status !== "approved") return;

    await ctx.db.patch(args.missionId, {
      status: "failed",
      errorMessage: args.errorMessage,
      updatedAt: Date.now(),
    });
  },
});

// Plain `ctx.db` helper behind `markDone` below — pulled out so a caller that
// must complete a Mission in the same transaction as its own other writes
// (the former Source delegation path, which created a production Mission and
// patched a technical pointer immediately before this) can call it directly
// instead of through `ctx.runMutation`.
// Going through `ctx.runMutation` here would run the completion as its own
// independent transaction — fine for a
// truly best-effort nested step, but wrong for this one: if the outer
// transaction's own writes then failed to commit, the Mission would be left
// `done` for a Mission whose delegate/child was never actually created.
export async function markMissionDone(
  ctx: MutationCtx,
  missionId: Id<"missions">,
  indexing?: Doc<"missions">["indexing"],
): Promise<void> {
  // The indexing mirror is written atomically with the done transition
  // (ADR-015), so the outcome and the terminal state can never diverge.
  await ctx.db.patch(missionId, {
    status: "done",
    updatedAt: Date.now(),
    ...(indexing !== undefined ? { indexing } : {}),
  });
}

export const markDone = internalMutation({
  args: { missionId: v.id("missions"), indexing: v.optional(indexingOutcomeV) },
  handler: async (ctx, args) => {
    await markMissionDone(ctx, args.missionId, args.indexing);
  },
});

export const deleteMission = mutation({
  args: {
    missionId: v.id("missions"),
  },
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found");

    // Validate instance ownership.
    const ownerId = await ownerIdFor(ctx, mission.instanceId);
    if (mission.ownerId !== ownerId) throw new Error("Forbidden");

    // Server-side eligibility guard: refuse while a Run is *live on the
    // Instance* — i.e. `dispatching` (exec command being enqueued) or `running`.
    // Such a Run has a callback (Event/RunResult) that would reference a deleted
    // mission/run if we removed it now. A `pending` Run is only queued in Convex
    // (the dispatcher has not claimed it) and is removed by the cascade, so a
    // mission stuck in `todo` stays deletable. The mission's own `doing` status
    // (⟺ a `running` Run) is checked too as cheap defence in depth.
    const liveRun = await ctx.db
      .query("runs")
      .withIndex("by_mission", (q) => q.eq("missionId", args.missionId))
      .filter((q) =>
        q.or(q.eq(q.field("status"), "dispatching"), q.eq(q.field("status"), "running")),
      )
      .first();
    if (mission.status === "doing" || liveRun !== null) {
      throw new Error("Cannot delete a mission while its run is in flight on the Project");
    }

    // Cascade: delete all Runs for this mission before deleting the mission
    // itself. Use batched deletion per Convex guidelines — .collect() is
    // unbounded and grows with every revision cycle. Sources are append-only
    // and outlive the Mission whose Run produced them (ADR-051).
    const BATCH = 32;
    for (;;) {
      const batch = await ctx.db
        .query("runs")
        .withIndex("by_mission", (q) => q.eq("missionId", args.missionId))
        .take(BATCH);
      if (batch.length === 0) break;
      for (const row of batch) {
        await ctx.db.delete(row._id);
      }
    }

    await ctx.db.delete(args.missionId);
  },
});

// Every non-terminal status: unlike `done`, these don't accumulate without
// bound (a Mission moves out of them), so a per-status `.take()` is enough —
// no pagination needed. Kept off the kanban's `done` column, which does grow
// unboundedly and is served by `listDoneByInstance` instead (issue: "load
// more" for Done, so the board doesn't fetch/render every Mission ever run).
const ACTIVE_STATUSES = ["todo", "doing", "blocked", "to_validate", "approved", "failed", "cancelled"] as const;
const ACTIVE_STATUS_CAP = 200;

export const listActiveByInstance = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await readOwnerId(ctx, args.instanceId);
    if (ownerId === null) return [];
    const byStatus = await Promise.all(
      ACTIVE_STATUSES.map((status) =>
        ctx.db
          .query("missions")
          .withIndex("by_instance_status_updated", (q) =>
            q.eq("instanceId", args.instanceId).eq("status", status),
          )
          .filter((q) => q.eq(q.field("ownerId"), ownerId))
          .order("desc")
          .take(ACTIVE_STATUS_CAP),
      ),
    );
    return byStatus.flat().sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

// Paginated "Done" kanban column (see `listActiveByInstance` above for why
// `done` is split out): the board fetches an initial page and loads more on
// demand instead of collecting every completed Mission at once.
export const listDoneByInstance = query({
  args: { instanceId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const ownerId = await readOwnerId(ctx, args.instanceId);
    if (ownerId === null) return { page: [], isDone: true, continueCursor: "" };
    return await ctx.db
      .query("missions")
      .withIndex("by_instance_status_updated", (q) => q.eq("instanceId", args.instanceId).eq("status", "done"))
      .order("desc")
      .filter((q) => q.eq(q.field("ownerId"), ownerId))
      .paginate(args.paginationOpts);
  },
});

// Recent Missions and status counts of one Agent, for its Overview page. The
// counts cover the most recent `OVERVIEW_SCAN_CAP` Missions only (an unbounded
// per-status count has no index for a single Template), so `truncated` tells
// the dashboard to show them as "N+".
const OVERVIEW_SCAN_CAP = 200;
const OVERVIEW_RECENT = 5;

export const overviewByTemplate = query({
  args: { instanceId: v.string(), templateId: v.string() },
  handler: async (ctx, args) => {
    const empty = { recent: [], counts: { doing: 0, toValidate: 0, failed: 0 }, truncated: false };
    const ownerId = await readOwnerId(ctx, args.instanceId);
    if (ownerId === null) return empty;
    const missions = await ctx.db
      .query("missions")
      .withIndex("by_instance_template_owner_updated", (q) =>
        q.eq("instanceId", args.instanceId).eq("templateId", args.templateId).eq("ownerId", ownerId),
      )
      .order("desc")
      .take(OVERVIEW_SCAN_CAP);
    const count = (status: Doc<"missions">["status"]) => missions.filter((m) => m.status === status).length;
    return {
      recent: missions.slice(0, OVERVIEW_RECENT).map((m) => ({
        _id: m._id,
        type: m.type,
        name: m.name,
        number: m.number,
        status: m.status,
        updatedAt: m.updatedAt,
      })),
      counts: { doing: count("doing"), toValidate: count("to_validate"), failed: count("failed") },
      truncated: missions.length === OVERVIEW_SCAN_CAP,
    };
  },
});

// Written exclusively by the Agent via REST HMAC tool. Only `summary` is
// patched — status is always derived from the Run lifecycle, never from here.
export const writeSummary = internalMutation({
  args: {
    missionId: v.id("missions"),
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.missionId, { summary: args.summary, updatedAt: Date.now() });
  },
});

// Backfill: assign sequential numbers to missions that lack one, ordered by
// createdAt within each project (instanceId). Idempotent — already-numbered
// missions are skipped. Also syncs the projectCounters to the max number seen.
export const backfillNumbers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allMissions = await ctx.db.query("missions").collect();
    // Group by instanceId, sort each group by createdAt asc
    const byInstance = new Map<string, typeof allMissions>();
    for (const m of allMissions) {
      const list = byInstance.get(m.instanceId) ?? [];
      list.push(m);
      byInstance.set(m.instanceId, list);
    }

    let patched = 0;
    for (const [instanceId, missions] of byInstance) {
      missions.sort((a, b) => a.createdAt - b.createdAt);

      // Find the current max number already assigned
      let maxExisting = 0;
      for (const m of missions) {
        if (m.number !== undefined && m.number > maxExisting) maxExisting = m.number;
      }

      // Assign numbers only to unnumbered missions, continuing from maxExisting
      let next = maxExisting;
      for (const m of missions) {
        if (m.number !== undefined) continue;
        next++;
        await ctx.db.patch(m._id, { number: next });
        patched++;
      }

      // Sync the counter
      const counter = await ctx.db
        .query("projectCounters")
        .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
        .unique();
      if (next > 0) {
        if (counter) {
          if (counter.missionCount < next) {
            await ctx.db.patch(counter._id, { missionCount: next });
          }
        } else {
          await ctx.db.insert("projectCounters", { instanceId, missionCount: next });
        }
      }
    }

    return { patched };
  },
});

export const stripFilesFromArtifacts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const missions = await ctx.db.query("missions").collect();
    let patched = 0;
    for (const mission of missions) {
      const lastResult = mission.lastResult as Record<string, unknown> | undefined;
      if (!lastResult) continue;

      const artifact = lastResult.artifact as Record<string, unknown> | undefined;
      const partialArtifact = lastResult.partialArtifact as Record<string, unknown> | undefined;

      const hasFiles = artifact && "files" in artifact;
      const hasPartialFiles = partialArtifact && "files" in partialArtifact;
      if (!hasFiles && !hasPartialFiles) continue;

      const cleanArtifact = artifact
        ? (artifact.metadata !== undefined
            ? { metadata: artifact.metadata as Record<string, string | number | boolean> }
            : {})
        : undefined;
      const cleanPartial = partialArtifact
        ? (partialArtifact.metadata !== undefined
            ? { metadata: partialArtifact.metadata as Record<string, string | number | boolean> }
            : {})
        : undefined;

      await ctx.db.patch(mission._id, {
        lastResult: {
          ...lastResult,
          ...(cleanArtifact !== undefined ? { artifact: cleanArtifact } : {}),
          ...(cleanPartial !== undefined ? { partialArtifact: cleanPartial } : {}),
        } as never,
      });
      patched++;
    }
    return { patched, total: missions.length };
  },
});
