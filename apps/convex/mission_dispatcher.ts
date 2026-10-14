import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server.js";
import { buildRuntimeResultEventId } from "@opengroow/protocol";
import { getRunMission } from "./runs.js";
import { runParent } from "./run_parent.js";
import { reconcileDecisionLogV } from "./mission_dispatcher/decision_log.js";
import type { Id } from "./_generated/dataModel.js";

export const loadDispatchInputs = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    // Dispatch builds a Mission context; a SourceJob's Run has none to load
    // (its own dispatch path is a separate concern), so it fails cleanly as
    // `dispatch_inputs_missing` instead of throwing.
    const mission = await getRunMission(ctx, run);
    if (!mission) return null;
    const projectAgent = await ctx.db
      .query("projectAgents")
      .withIndex("by_instance_template", (q) =>
        q.eq("instanceId", run.instanceId).eq("templateId", run.templateId),
      )
      .unique();
    if (!projectAgent || !projectAgent.workspaceKey) return null;

    const brandCore = await ctx.db
      .query("brandCores")
      .withIndex("by_instance", (q) => q.eq("instanceId", run.instanceId))
      .unique();

    return {
      mission: {
        _id: mission._id,
        ownerId: mission.ownerId,
        instanceId: mission.instanceId,
        templateId: mission.templateId,
        type: mission.type,
        payload: mission.payload,
        ...(mission.lastResult !== undefined ? { lastResult: mission.lastResult } : {}),
        ...(mission.lastArtifact !== undefined ? { lastArtifact: mission.lastArtifact } : {}),
        ...(mission.lastIntermediateResult !== undefined
          ? { lastIntermediateResult: mission.lastIntermediateResult }
          : {}),
        ...(mission.lastRetryableFailure !== undefined
          ? { lastRetryableFailure: mission.lastRetryableFailure }
          : {}),
        ...(mission.retryableFailureCount !== undefined
          ? { retryableFailureCount: mission.retryableFailureCount }
          : {}),
        ...(brandCore
          ? {
              brandCore: {
                audience: brandCore.audience,
                tone: brandCore.tone,
                offer: brandCore.offer,
                positioning: brandCore.positioning,
                editorialRules: brandCore.editorialRules,
                constraints: brandCore.constraints,
                avoid: brandCore.avoid,
                notes: brandCore.notes,
              },
            }
          : {}),
      },
      run: {
        _id: run._id,
        missionId: mission._id,
        agentName: run.agentName,
        sessionKey: run.sessionKey,
        ...(run.humanFeedback !== undefined ? { humanFeedback: run.humanFeedback } : {}),
      },
      workspaceKey: projectAgent.workspaceKey,
      config: projectAgent.config ?? null,
    };
  },
});

export const listRunsToReconcile = internalQuery({
  args: {},
  handler: async (ctx) => {
    const running = await ctx.db
      .query("runs")
      .withIndex("by_status_created", (q) => q.eq("status", "running"))
      .collect();
    const dispatching = await ctx.db
      .query("runs")
      .withIndex("by_status_created", (q) => q.eq("status", "dispatching"))
      .collect();
    const awaitingJob = await ctx.db
      .query("runs")
      .withIndex("by_status_created", (q) => q.eq("status", "awaiting_job"))
      .collect();
    return await Promise.all(
      [...running, ...dispatching, ...awaitingJob].map(async (r) => {
        // Mission type belongs to the Mission, not to the optional external
        // job pointer. The dispatcher needs it for per-Mission-type watchdogs.
        const mission = await getRunMission(ctx, r);
        return {
          _id: r._id,
          status: r.status,
          instanceId: r.instanceId,
          templateId: r.templateId,
          parent: runParent(r),
          sourceIngestion: ((r as typeof r & { jobId?: Id<"jobs"> }).jobId !== undefined)
            && (await ctx.db.get((r as typeof r & { jobId?: Id<"jobs"> }).jobId!))?.type === "source_ingestion",
          sourceScoring: ((r as typeof r & { jobId?: Id<"jobs"> }).jobId !== undefined)
            && (await ctx.db.get((r as typeof r & { jobId?: Id<"jobs"> }).jobId!))?.type === "source_scoring",
          sourceRouting: ((r as typeof r & { jobId?: Id<"jobs"> }).jobId !== undefined)
            && (await ctx.db.get((r as typeof r & { jobId?: Id<"jobs"> }).jobId!))?.type === "source_routing",
          ownerId: r.ownerId,
          dispatchedAt: r.dispatchedAt,
          dispatchCommandId: r.dispatchCommandId,
          resultReadCommandId: r.resultReadCommandId,
          mcpJob: r.mcpJob,
          missionType: mission?.type ?? r.mcpJob?.missionType ?? "",
          missionPayload: mission?.payload,
          templateVersion: mission?.templateVersion,
          retryableFailureCount: mission?.retryableFailureCount ?? 0,
        };
      }),
    );
  },
});

export const loadReconcileState = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;

    const mission = await getRunMission(ctx, run);

    const projectAgent = await ctx.db
      .query("projectAgents")
      .withIndex("by_instance_template", (q) =>
        q.eq("instanceId", run.instanceId).eq("templateId", run.templateId),
      )
      .unique();
    const workspaceKey = projectAgent?.workspaceKey ?? null;

    let execResult: { ok: boolean; error?: string } | null = null;
    if (run.dispatchCommandId) {
      const evt = await ctx.db
        .query("events")
        .withIndex("by_instance_event", (q) =>
          q.eq("instanceId", run.instanceId).eq("eventId", buildRuntimeResultEventId(run.dispatchCommandId!)),
        )
        .unique();
      if (evt) {
        const p = (evt.payload ?? {}) as { ok?: boolean; error?: string };
        execResult = { ok: p.ok === true, error: p.error };
      }
    }

    let readResult: {
      ok: boolean;
      error?: string;
      data?: { content?: string; found?: boolean };
    } | null = null;
    if (run.resultReadCommandId) {
      const evt = await ctx.db
        .query("events")
        .withIndex("by_instance_event", (q) =>
          q.eq("instanceId", run.instanceId).eq("eventId", buildRuntimeResultEventId(run.resultReadCommandId!)),
        )
        .unique();
      if (evt) {
        const p = (evt.payload ?? {}) as {
          ok?: boolean;
          error?: string;
          data?: { content?: string; found?: boolean };
        };
        readResult = { ok: p.ok === true, error: p.error, data: p.data };
      }
    }

    let finalReadResult: {
      ok: boolean;
      error?: string;
      data?: { content?: string; found?: boolean };
    } | null = null;
    if (run.finalReadCommandId) {
      const evt = await ctx.db
        .query("events")
        .withIndex("by_instance_event", (q) =>
          q.eq("instanceId", run.instanceId).eq("eventId", buildRuntimeResultEventId(run.finalReadCommandId!)),
        )
        .unique();
      if (evt) {
        const p = (evt.payload ?? {}) as {
          ok?: boolean;
          error?: string;
          data?: { content?: string; found?: boolean };
        };
        finalReadResult = { ok: p.ok === true, error: p.error, data: p.data };
      }
    }

    return {
      runId: run._id,
      parent: runParent(run),
      sourceIngestion: ((run as typeof run & { jobId?: Id<"jobs"> }).jobId !== undefined)
        && (await ctx.db.get((run as typeof run & { jobId?: Id<"jobs"> }).jobId!))?.type === "source_ingestion",
      sourceScoring: ((run as typeof run & { jobId?: Id<"jobs"> }).jobId !== undefined)
        && (await ctx.db.get((run as typeof run & { jobId?: Id<"jobs"> }).jobId!))?.type === "source_scoring",
      sourceRouting: ((run as typeof run & { jobId?: Id<"jobs"> }).jobId !== undefined)
        && (await ctx.db.get((run as typeof run & { jobId?: Id<"jobs"> }).jobId!))?.type === "source_routing",
      instanceId: run.instanceId,
      missionType: mission?.type ?? "",
      workspaceKey,
      resultReadCommandId: run.resultReadCommandId ?? null,
      execResult,
      readResult,
      finalReadCommandId: run.finalReadCommandId ?? null,
      finalReadResult,
      retryableFailureCount: mission?.retryableFailureCount ?? 0,
    };
  },
});

export const setResultReadCommandId = internalMutation({
  args: { runId: v.id("runs"), commandId: v.id("commands") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      resultReadCommandId: args.commandId,
      updatedAt: Date.now(),
    });
  },
});

export const setFinalReadCommandId = internalMutation({
  args: { runId: v.id("runs"), commandId: v.id("commands") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      finalReadCommandId: args.commandId,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Append one reconciliation decision to the Run's decision log (issue #237).
 * Called by `reconcileRuns`/`pollExternalJobRun` right after `decideReconciliation`/
 * `decideExternalJobPoll` produced a decision and before (or after) it's applied
 * — this is additive logging only, it never changes Run/Mission state.
 *
 * `wait` decisions are deduped: if the most recently logged decision for this
 * Run was also `wait`, this call is a no-op. A Run can sit in `running` for a
 * long time between real transitions (e.g. waiting on the exec or the file
 * read to land), and logging a `wait` every tick would flood the log with
 * rows that carry no new information. Any other decision type is always
 * logged, since each one reflects new information arriving.
 */
export const recordReconcileDecision = internalMutation({
  args: { runId: v.id("runs"), missionId: v.optional(v.id("missions")), decision: reconcileDecisionLogV },
  handler: async (ctx, args) => {
    if (args.decision.type === "wait") {
      const last = await ctx.db
        .query("runReconcileEvents")
        .withIndex("by_run_created", (q) => q.eq("runId", args.runId))
        .order("desc")
        .first();
      if (last?.decision.type === "wait") {
        return null;
      }
    }
    return await ctx.db.insert("runReconcileEvents", {
      runId: args.runId,
      missionId: args.missionId,
      decision: args.decision,
      createdAt: Date.now(),
    });
  },
});

/**
 * Read a Run's reconciliation decision log in the order it was applied
 * (issue #237). Internal-only for now — a UI view is a separate follow-up.
 */
export const listReconcileDecisions = internalQuery({
  args: { runId: v.id("runs"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("runReconcileEvents")
      .withIndex("by_run_created", (q) => q.eq("runId", args.runId))
      .order("asc")
      .take(args.limit ?? 200);
  },
});
