import { v } from "convex/values";
import { internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { runResultV } from "./run_result.js";
import { settleSourceJobRun } from "./source_jobs.js";
import { ingestAndDecideOutcome, ingestHandoff } from "./source_jobs/ingest_sources.js";
import { failScoringRun, settleScoringRun } from "./score_jobs.js";
import { failRoutingRun, settleRoutingRun } from "./source_routing.js";
import { runParent, type RunParentRecord } from "./run_parent.js";
import { exclusiveResourcesOf } from "@opengroow/agent-templates";
import { getTemplateRegistry } from "./template_registry.js";
import type { RetryFeedback } from "./source_jobs/retry_feedback.js";
import { ownerOfInstance } from "./projects.js";

// The Mission a Run belongs to, or null for a Job's Run (or a deleted Mission).
export async function getRunMission(
  ctx: QueryCtx,
  run: RunParentRecord,
): Promise<Doc<"missions"> | null> {
  const parent = runParent(run);
  return parent.kind === "mission" ? await ctx.db.get(parent.missionId) : null;
}

// Terminal outcomes of a Run, each stamped with `completedAt`.
export const TERMINAL_RUN_STATUSES = ["completed", "resumed", "failed", "cancelled"] as const;

const LIVE_RUN_STATUSES = ["dispatching", "running", "awaiting_job"] as const;

// The newest live (dispatching/running/awaiting_job) Run for a Mission, or
// null. Used by `missions.reserveCancellation` (issue #482) to find the
// sessionKey to target the gateway's kill request at, and to guard Stop
// against a Mission that isn't actually running — via a bounded lookup (3
// indexed point queries, one per live status, through
// `by_mission_status_created`) rather than an unbounded scan of the
// Mission's full Run history (which can grow indefinitely across ADR-026
// resumes/retries).
export async function findLiveRunForMission(
  ctx: QueryCtx,
  missionId: Id<"missions">,
): Promise<Doc<"runs"> | null> {
  const candidates = await Promise.all(
    LIVE_RUN_STATUSES.map((status) =>
      ctx.db
        .query("runs")
        .withIndex("by_mission_status_created", (q) =>
          q.eq("missionId", missionId).eq("status", status),
        )
        .order("desc")
        .first(),
    ),
  );
  const liveRuns = candidates.filter((run): run is Doc<"runs"> => run !== null);
  // A Mission can carry a stale `dispatching` Run alongside the one actually
  // executing (ADR-026 resumes create a fresh Run per External Job hop) —
  // take the newest, not just any live one.
  liveRuns.sort((a, b) => b.createdAt - a.createdAt);
  return liveRuns[0] ?? null;
}

// Exclusive resources a Run's Mission type uses, as declared by its Template's
// manifest (`exclusiveResources`, issue #656). A Project is identified by its
// Instance id (see template_registry.ts). Two Runs of the same owner sharing a
// resource never run at once, even across Instances (they may drive one paired
// device) and across Templates. Runs of different owners never contend. A Run with no Mission (a Job's Run) uses none.
async function exclusiveResourcesOfRun(ctx: QueryCtx, run: Doc<"runs">): Promise<string[]> {
  const mission = await getRunMission(ctx, run);
  if (!mission) return [];
  // A Template that fails to resolve holds no resource: the claim goes ahead
  // and the dispatcher fails that Run with the actual load error.
  const template = await getTemplateRegistry(ctx)
    .resolve(run.instanceId, run.templateId)
    .catch(() => undefined);
  return exclusiveResourcesOf(template?.manifest, mission.type);
}

async function isBlockedByExclusiveResource(ctx: QueryCtx, run: Doc<"runs">): Promise<boolean> {
  const resources = await exclusiveResourcesOfRun(ctx, run);
  if (resources.length === 0) return false;
  for (const status of LIVE_RUN_STATUSES) {
    for await (const active of ctx.db
      .query("runs")
      .withIndex("by_status_created", (q) => q.eq("status", status))) {
      if (active._id === run._id || active.ownerId !== run.ownerId) continue;
      const held = await exclusiveResourcesOfRun(ctx, active);
      if (held.some((resource) => resources.includes(resource))) return true;
    }
  }
  return false;
}

async function readOwnerId(ctx: QueryCtx, instanceId: string): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Authentication required");
  }
  const matches = await ctx.db
    .query("instances")
    .withIndex("by_openclaw_id", (q) => q.eq("openclawId", instanceId))
    .collect();
  if (matches.length !== 1) return null;
  const ownerId = await ownerOfInstance(ctx, matches[0]);
  if (ownerId && ownerId !== identity.subject && ownerId !== identity.tokenIdentifier) {
    return null;
  }
  return identity.subject ?? identity.tokenIdentifier;
}

export const countActiveByInstanceTemplate = internalQuery({
  args: { instanceId: v.string(), templateId: v.string() },
  handler: async (ctx, args) => {
    // "pending" is included because the dispatcher can claim it at any time after
    // this check, which would result in a dispatch against a deactivated agent.
    let count = 0;
    for (const status of ["pending", "dispatching", "running", "awaiting_job"] as const) {
      for await (const _ of ctx.db
        .query("runs")
        .withIndex("by_instance_template_status", (q) =>
          q.eq("instanceId", args.instanceId).eq("templateId", args.templateId).eq("status", status),
        )) count++;
    }
    return count;
  },
});

export const claimNextPending = internalMutation({
  args: {},
  handler: async (ctx) => {
    const pendings = await ctx.db
      .query("runs")
      .withIndex("by_status_created", (q) => q.eq("status", "pending"))
      .collect();
    pendings.sort((a, b) => a.createdAt - b.createdAt);

    for (const run of pendings) {
      // Keep the existing runtime-level lock for all Runs. `instanceId` is an
      // OpenClaw runtime, though, and multiple runtimes can target one paired
      // physical device.
      const concurrent = await ctx.db
        .query("runs")
        .withIndex("by_instance_template_status", (q) => q.eq("instanceId", run.instanceId))
        .collect();
      const hasActive = concurrent.some(
        (r) =>
          r._id !== run._id &&
          (r.status === "dispatching" ||
            r.status === "running" ||
            r.status === "awaiting_job"),
      );
      if (hasActive) continue;

      // Declared exclusive resources (e.g. the paired phone): wait behind any
      // live Run, on any Instance, that uses one of the same.
      if (await isBlockedByExclusiveResource(ctx, run)) continue;

      // Derived before the patch: a Run with no parent (or two) must fail the
      // claim without having been moved to `dispatching`.
      const parent = runParent(run);
      const now = Date.now();
      await ctx.db.patch(run._id, {
        status: "dispatching",
        dispatchedAt: now,
        updatedAt: now,
      });
      return { runId: run._id, parent };
    }
    return null;
  },
});

export const markRunning = internalMutation({
  args: {
    runId: v.id("runs"),
    dispatchCommandId: v.id("commands"),
    // ADR-050: an audit-trail copy of what was dispatched, not read back from
    // anywhere else — optional so callers that don't build these (e.g. Runs
    // with no template, see mission_dispatcher_node.ts) may omit them.
    agentsMdSnapshot: v.optional(v.string()),
    contextMdSnapshot: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`Run not found: ${args.runId}`);
    if (run.status !== "dispatching") {
      throw new Error(`illegal transition: markRunning from status ${run.status}`);
    }
    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: "running",
      dispatchCommandId: args.dispatchCommandId,
      agentsMdSnapshot: args.agentsMdSnapshot,
      contextMdSnapshot: args.contextMdSnapshot,
      updatedAt: now,
    });
    const parent = runParent(run);
    if (parent.kind === "mission") {
      await ctx.db.patch(parent.missionId, { status: "doing", updatedAt: now });
    }
  },
});

export const markAwaitingJob = internalMutation({
  args: {
    runId: v.id("runs"),
    job: v.object({
      serverName: v.string(),
      jobId: v.string(),
      summary: v.string(),
      reviewQuestions: v.array(v.string()),
      jobType: v.string(),
      missionType: v.optional(v.string()),
      sourceRef: v.optional(v.string()),
      // SourceJob handoff (#568): position of the enriched Source in `sources`.
      sourcePosition: v.optional(v.number()),
    }),
    // SourceJob handoff (#568): the Sources of the result file, inserted here.
    sources: v.optional(v.array(v.any())),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`Run not found: ${args.runId}`);
    const { sourcePosition, ...job } = args.job;
    let sourceRef = job.sourceRef;
    let intermediateResult: { feedback: RetryFeedback } | undefined;
    const parent = runParent(run);
    const sourceIngestion = parent.kind === "job" && (await ctx.db.get(parent.jobId))?.type === "source_ingestion";
    if (sourceIngestion) {
      // A cancelled Run hands off nothing: the operator's Stop wins.
      if (run.status === "cancelled") return;
      if (run.status === "running") {
        const handoff = await ingestHandoff(ctx, run, job.summary, args.sources ?? [], { sourcePosition, sourceRef });
        if (!handoff.ok) {
          const now = Date.now();
          await ctx.db.patch(args.runId, { status: "completed", result: handoff.result, completedAt: now, updatedAt: now });
          await settleSourceJobRun(ctx, run, handoff.outcome);
          return;
        }
        sourceRef = handoff.sourceRef;
        // What the chain must remember once the enrichment resumes it.
        intermediateResult = { feedback: { errors: [], accepted: handoff.accepted, surplus: handoff.surplus } };
      }
    }
    if (run.status !== "running") {
      throw new Error(`illegal transition: markAwaitingJob from status ${run.status}`);
    }
    await ctx.db.patch(args.runId, {
      status: "awaiting_job",
      mcpJob: { ...job, ...(sourceRef !== undefined ? { sourceRef } : {}) },
      ...(intermediateResult ? { intermediateResult } : {}),
      updatedAt: Date.now(),
    });
    // Mission stays `doing`: the job is still in flight, just no longer the
    // agent's responsibility to babysit.
  },
});

export const markCompleted = internalMutation({
  // `sources`: the Sources of a SourceJob execution's result file (#564),
  // ingested here so a cancelled Run (early return below) inserts nothing.
  args: { runId: v.id("runs"), result: runResultV, sources: v.optional(v.array(v.any())) },
  handler: async (ctx, args): Promise<{ applied: boolean }> => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`Run not found: ${args.runId}`);
    // A late-arriving exec result racing an operator-initiated Stop
    // (issue #482): the Run already moved to the terminal `cancelled` status,
    // so this reconciliation write is a no-op rather than an illegal-
    // transition throw — the operator's decision wins. Reports `applied:
    // false` so the caller (`mission_dispatcher_node.reconcileRun`) knows not
    // to follow up with writes derived from a result that was never actually
    // recorded.
    if (run.status === "cancelled") return { applied: false };
    if (run.status !== "running" && run.status !== "awaiting_job") {
      throw new Error(`illegal transition: markCompleted from status ${run.status}`);
    }
    const now = Date.now();
    const parent = runParent(run);

    // Source ingestion is a generic Job capability. Its Run has no Mission to
    // carry the outcome, and its validated Sources settle the Job cursor.
    if (parent.kind === "job" && (await ctx.db.get(parent.jobId))?.type === "source_ingestion") {
      const { result, outcome } = await ingestAndDecideOutcome(ctx, run, args.result, args.sources);
      await ctx.db.patch(args.runId, { status: "completed", result, completedAt: now, updatedAt: now });
      await settleSourceJobRun(ctx, run, outcome);
      return { applied: true };
    }

    if (parent.kind === "job" && (await ctx.db.get(parent.jobId))?.type === "source_scoring") {
      await ctx.db.patch(args.runId, { status: "completed", result: args.result, completedAt: now, updatedAt: now });
      await settleScoringRun(ctx, { ...run, jobId: parent.jobId }, args.result);
      return { applied: true };
    }

    if (parent.kind === "job" && (await ctx.db.get(parent.jobId))?.type === "source_routing") {
      await ctx.db.patch(args.runId, { status: "completed", result: args.result, completedAt: now, updatedAt: now });
      await settleRoutingRun(ctx, { ...run, jobId: parent.jobId }, args.result);
      return { applied: true };
    }

    if (parent.kind === "job") {
      const jobOutcome = args.result.status === "failed" ? "failed" : "succeeded";
      await ctx.db.patch(args.runId, {
        status: "completed",
        result: args.result,
        completedAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(parent.jobId, {
        latestRunId: args.runId,
        lastRunAt: now,
        lastOutcome: jobOutcome,
        lastError: args.result.status === "failed" ? args.result.summary : undefined,
        updatedAt: now,
      });
      return { applied: true };
    }

    await ctx.db.patch(args.runId, {
      status: "completed",
      result: args.result,
      completedAt: now,
      updatedAt: now,
    });
    const mission = await ctx.db.get(parent.missionId);

    // Exhaustive over every stored (terminal) RunResult status — the compiler
    // flags a missing arm the moment a new branch is added to runResultV.
    const missionStatusByResult: Record<typeof args.result.status, Doc<"missions">["status"]> = {
      success: "done",
      needs_human_review: "to_validate",
      blocked_external: "blocked",
      failed: "failed",
    };
    const missionStatus = missionStatusByResult[args.result.status];

    // Preserve lastArtifact only when result carries an artifact (success /
    // needs_human_review). A failed result must NEVER overwrite it so the agent
    // can find the external reference (e.g. articleId) even after a failed run;
    // blocked_external carries no artifact either (only an external link).
    const artifactPatch =
      "artifact" in args.result && args.result.artifact != null
        ? { lastArtifact: args.result.artifact }
        : {};

    await ctx.db.patch(parent.missionId, {
      status: missionStatus,
      lastResult: args.result,
      ...artifactPatch,
      updatedAt: now,
    });

    if (args.result.status === "needs_human_review") {
      await ctx.runMutation(internal.events.store, {
        instanceId: run.instanceId,
        event: {
          id: `ArticleToValidate:${parent.missionId}:${args.runId}`,
          type: "ArticleToValidate",
          payload: { missionId: parent.missionId, runId: args.runId },
          ts: now,
        },
      });

      // autoPublish (issue #329): if the Mission opted in, chain approve →
      // publish immediately (zero-delay schedule) instead of waiting for a
      // human to act on the ArticleToValidate event above. Scheduled rather
      // than invoked directly because this is a mutation and the chain needs
      // to make outbound HTTP calls (node action).
      //
      // needs_human_review carries an artifact only optionally (run_result.ts)
      // — an agent can reach this status while only explaining why it needs a
      // human (no artifact produced yet). autoPublishChain's approve step
      // requires an artifact and fails loudly if none exists, so only chain
      // it when there is actually something to approve; otherwise leave the
      // Mission at to_validate for a human, same as when autoPublish is off.
      if (mission?.autoPublish === true && args.result.artifact != null) {
        await ctx.scheduler.runAfter(0, internal.missions_node.autoPublishChain, {
          missionId: parent.missionId,
        });
      }
    }

    return { applied: true };
  },
});

/**
 * An Intermediate External Job (ADR-026) completed: no terminal RunResult,
 * no Mission status transition. This Run is done (never re-polled), but
 * unlike `markCompleted` it carries no `result` and never touches the
 * Mission — the caller (`missions.resumeMission`) is responsible for
 * writing `mission.lastIntermediateResult` and creating the resuming Run.
 */
export const markResumed = internalMutation({
  args: { runId: v.id("runs"), intermediateResult: v.optional(v.any()) },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`Run not found: ${args.runId}`);
    // See markCompleted's comment: a cancelled Run must never be re-decided
    // by a late reconciliation tick.
    if (run.status === "cancelled") return;
    if (run.status !== "running" && run.status !== "awaiting_job") {
      throw new Error(`illegal transition: markResumed from status ${run.status}`);
    }
    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: "resumed",
      completedAt: now,
      updatedAt: now,
      ...(args.intermediateResult !== undefined ? { intermediateResult: args.intermediateResult } : {}),
    });
  },
});

export const markFailed = internalMutation({
  args: {
    runId: v.id("runs"),
    code: v.string(),
    message: v.string(),
    // SourceJob only (#567): the message is fed back to a resumed execution.
    retryWithFeedback: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ applied: boolean }> => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`Run not found: ${args.runId}`);
    // See markCompleted's comment: a cancelled Run must never be re-decided
    // by a late reconciliation tick (e.g. the killed process's own timeout).
    // Reports `applied: false` so a caller can tell the write was skipped.
    if (run.status === "cancelled") return { applied: false };
    if (run.status === "completed" || run.status === "failed") {
      throw new Error(`illegal transition: markFailed from status ${run.status}`);
    }
    const now = Date.now();
    const errorMessage = `${args.code}: ${args.message}`;
    await ctx.db.patch(args.runId, {
      status: "failed",
      completedAt: now,
      errorMessage,
      updatedAt: now,
    });
    const parent = runParent(run);
    if (parent.kind === "job" && (await ctx.db.get(parent.jobId))?.type === "source_scoring") {
      await failScoringRun(ctx, { ...run, jobId: parent.jobId }, errorMessage, args.retryWithFeedback === true);
      return { applied: true };
    }
    if (parent.kind === "job" && (await ctx.db.get(parent.jobId))?.type === "source_routing") {
      await failRoutingRun(ctx, { ...run, jobId: parent.jobId }, errorMessage, args.retryWithFeedback === true);
      return { applied: true };
    }
    await settleSourceJobRun(ctx, run, {
      ok: false,
      error: errorMessage,
      ...(args.retryWithFeedback ? { feedback: { errors: [{ messages: [args.message] }] } } : {}),
    });
    if (parent.kind === "mission") {
      await ctx.db.patch(parent.missionId, {
        status: "failed",
        errorMessage,
        updatedAt: now,
      });
    } else if (parent.kind === "job") {
      await ctx.db.patch(parent.jobId, {
        latestRunId: args.runId,
        lastRunAt: now,
        lastOutcome: "failed",
        lastError: errorMessage,
        updatedAt: now,
      });
    }
    return { applied: true };
  },
});

/**
 * Terminal transition for the dashboard's Stop action (issue #482): patches
 * both the Run and its owning Mission to `cancelled` in one step, mirroring
 * how markCompleted/markFailed already patch the owning Mission alongside
 * the Run. Called only after the gateway confirms the kill request
 * succeeded.
 *
 * The caller (missions_node.cancelMission) checks eligibility *before* a
 * dispatch-and-wait round-trip that can take seconds, so this re-asserts it
 * here at write time: a Run that finished naturally during that window (and
 * may already have carried its Mission to `to_validate`/`done`, possibly
 * auto-published) must not be rewritten to `cancelled` with a clobbered
 * `completedAt`. Losing that race is a no-op, not an error — the operator's
 * intent simply arrived after the Run had already ended.
 *
 * Also clears the Mission's `cancelling` marker (set by `cancelMission`
 * before the dispatch-and-wait round-trip, so `resumeMission`/
 * `resumeMissionAfterRetryableFailure` reject any resume attempt landing
 * during that window) — the terminal `cancelled` status alone is enough to
 * keep rejecting resumes from here on.
 */
export const markCancelled = internalMutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`Run not found: ${args.runId}`);
    if (
      run.status !== "dispatching" &&
      run.status !== "running" &&
      run.status !== "awaiting_job"
    ) {
      return;
    }
    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: "cancelled",
      completedAt: now,
      updatedAt: now,
    });
    const parent = runParent(run);
    if (parent.kind === "job" && (await ctx.db.get(parent.jobId))?.type === "source_scoring") {
      await failScoringRun(ctx, { ...run, jobId: parent.jobId }, "cancelled", false);
      return;
    }
    if (parent.kind === "job" && (await ctx.db.get(parent.jobId))?.type === "source_routing") {
      await failRoutingRun(ctx, { ...run, jobId: parent.jobId }, "cancelled", false);
      return;
    }
    await settleSourceJobRun(ctx, run, { ok: false, error: "cancelled" });
    if (parent.kind === "mission") {
      await ctx.db.patch(parent.missionId, {
        status: "cancelled",
        cancelling: false,
        updatedAt: now,
      });
    }
  },
});

export const get = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    const ownerId = await readOwnerId(ctx, run.instanceId);
    if (ownerId !== run.ownerId) return null;
    return run;
  },
});

export const listByMission = query({
  args: { missionId: v.id("missions") },
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) return [];
    const ownerId = await readOwnerId(ctx, mission.instanceId);
    if (ownerId !== mission.ownerId) return [];
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_mission", (q) => q.eq("missionId", args.missionId))
      .collect();
    // agentsMdSnapshot/contextMdSnapshot (ADR-050) can each be sizeable
    // markdown documents; no caller of this list view needs them — they're
    // only ever read for a single Run via `runs.get`.
    return runs.map(({ agentsMdSnapshot: _agentsMdSnapshot, contextMdSnapshot: _contextMdSnapshot, ...rest }) => rest);
  },
});

// Largest batch one caller tick may receive — "a bound fixed at build time"
// (ADR-051). The caller advances its cursor to the last Run returned, so a
// backlog larger than this is drained over successive ticks rather than lost.
export const MISSION_RUNS_BATCH_LIMIT = 200;

// The Agent's Runs *of Missions* that reached a terminal outcome at or after
// `since` (ms) and, when given, at or before `until`, oldest first — one bounded
// range scan per terminal status via `by_instance_template_status_completed`.
// Runs whose RunParent is a SourceJob are excluded.
export async function listMissionRunsCompletedBetween(
  ctx: QueryCtx,
  args: { instanceId: string; templateId: string; since: number; until?: number },
): Promise<Doc<"runs">[]> {
  const perStatus = await Promise.all(
    TERMINAL_RUN_STATUSES.map((status) =>
      ctx.db
        .query("runs")
        .withIndex("by_instance_template_status_completed", (q) => {
          const from = q
            .eq("instanceId", args.instanceId)
            .eq("templateId", args.templateId)
            .eq("status", status)
            .gte("completedAt", args.since);
          return args.until === undefined ? from : from.lte("completedAt", args.until);
        })
        // Oldest first (index order), so the per-status cut and the merged
        // cut below both keep the front of the backlog.
        .take(MISSION_RUNS_BATCH_LIMIT),
    ),
  );
  return perStatus
    .flat()
    .filter((run) => runParent(run).kind === "mission")
    .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0))
    .slice(0, MISSION_RUNS_BATCH_LIMIT);
}

export const listMissionRunsCompletedSince = internalQuery({
  args: { instanceId: v.string(), templateId: v.string(), since: v.number(), until: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<"runs">[]> => listMissionRunsCompletedBetween(ctx, args),
});

export const getByIdInternal = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args): Promise<Doc<"runs"> | null> => {
    return await ctx.db.get(args.runId);
  },
});

// Most recently created Run dispatched for the Agent identified by
// (instanceId, templateId) — used to pre-select "the latest Run" for the
// Agent Logs page (#231) without trusting runtime mtimes. `by_instance_template_created`
// orders directly on `createdAt`, so this is a single indexed lookup rather
// than collecting every Run for the Agent and reducing in memory.
export const getLatestByInstanceTemplate = internalQuery({
  args: { instanceId: v.string(), templateId: v.string() },
  handler: async (ctx, args): Promise<Doc<"runs"> | null> => {
    return await ctx.db
      .query("runs")
      .withIndex("by_instance_template_created", (q) =>
        q.eq("instanceId", args.instanceId).eq("templateId", args.templateId),
      )
      .order("desc")
      .first();
  },
});

// One-time backfill for Runs written before #243 introduced `mcpJob.jobType`.
// Those legacy `awaiting_job` Runs have an `mcpJob` with no `jobType`, which
// the schema now allows (widened to optional) but which the rest of the
// External Job polling code assumes is either present or safely absent — this
// patches them to a stable, greppable sentinel instead. Scoped to the
// `by_status_created` "awaiting_job" slice, not a full table scan, since only
// Runs still parked there can have a stale `mcpJob` shape (terminal Runs'
// `mcpJob` is never re-read). Safe to remove once no more legacy docs exist.
export const backfillLegacyMcpJobType = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ patched: number }> => {
    const awaitingJob = await ctx.db
      .query("runs")
      .withIndex("by_status_created", (q) => q.eq("status", "awaiting_job"))
      .collect();

    let patched = 0;
    for (const run of awaitingJob) {
      if (run.mcpJob !== undefined && run.mcpJob.jobType === undefined) {
        await ctx.db.patch(run._id, {
          mcpJob: { ...run.mcpJob, jobType: "legacy" },
          updatedAt: Date.now(),
        });
        patched++;
      }
    }
    return { patched };
  },
});
