import { v } from "convex/values";
import { query } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Doc } from "./_generated/dataModel.js";
import { readOwnerId } from "./instance_ownership.js";

export type ClientSafeRun = Pick<
  Doc<"runs">,
  "_id" | "missionId" | "status" | "createdAt" | "completedAt" | "errorMessage" | "result"
>;

/**
 * Lists the Missions belonging to the Agent that owns a given Workspace
 * (ADR-025 / #231) — never all Missions in the Project. Ordered most recently
 * updated first, so the Agent Logs page can default to the most active
 * Mission.
 */
export const listMissionsForWorkspace = query({
  args: { instanceId: v.string(), workspaceKey: v.string() },
  handler: async (ctx, args): Promise<Doc<"missions">[]> => {
    const ownerId = await readOwnerId(ctx, args.instanceId);
    if (ownerId === null) return [];

    const projectAgent = await ctx.runQuery(internal.project_agents.getByInstanceAndWorkspaceKey, {
      instanceId: args.instanceId,
      workspaceKey: args.workspaceKey,
    });
    const templateId = projectAgent?.templateId;
    if (!templateId) return [];

    return ctx.db
      .query("missions")
      .withIndex("by_instance_template_owner_updated", (q) =>
        q.eq("instanceId", args.instanceId).eq("templateId", templateId).eq("ownerId", ownerId),
      )
      .order("desc")
      .take(50);
  },
});

/**
 * Lists the Runs of a Mission for the Agent Logs page, stripped of
 * `sessionKey` — that identifier is an OpenClaw implementation detail that
 * must never reach the dashboard UI (ADR-025, GLOSSARY.md "what the user
 * never sees"). Selecting a Run's transcript instead goes through
 * `workspace_logs_node.getWorkspaceRunTranscript`, which resolves
 * `sessionKey` server-side from the Run's `_id`.
 */
export const listRunsForMission = query({
  args: { missionId: v.id("missions") },
  handler: async (ctx, args): Promise<ClientSafeRun[]> => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) return [];
    const ownerId = await readOwnerId(ctx, mission.instanceId);
    if (ownerId !== mission.ownerId) return [];

    const runs = await ctx.db
      .query("runs")
      .withIndex("by_mission", (q) => q.eq("missionId", args.missionId))
      .order("desc")
      .take(100);

    return runs.map((run) => ({
      _id: run._id,
      missionId: run.missionId,
      status: run.status,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      errorMessage: run.errorMessage,
      result: run.result,
    }));
  },
});

/** A job Run as the Agent Logs page sees it: status, date and error, never
 * `sessionKey`. The Run's result is read on the Sources page, not here. */
export type ClientSafeJobRun = Pick<
  Doc<"runs">,
  "_id" | "status" | "createdAt" | "completedAt" | "errorMessage"
> & { jobId: Doc<"jobs">["_id"] };

export type ClientSafeJob = {
  _id: Doc<"jobs">["_id"];
  templateId: string;
  jobType: string;
  agentName: string;
  state: "active" | "paused";
  lastRunAt?: number;
  lastOutcome?: "succeeded" | "failed" | "skipped";
  lastError?: string;
};

function jobLabel(type: Doc<"jobs">["type"]): string {
  switch (type) {
    case "source_ingestion": return "Social source ingestion";
    case "source_scoring": return "Source scoring";
    case "source_routing": return "Source routing";
    default: return type;
  }
}

/**
 * Lists every generic Job of the Agent that owns a given Workspace with its
 * last outcome and error.
 */
export const listJobsForWorkspace = query({
  args: { instanceId: v.string(), workspaceKey: v.string() },
  handler: async (ctx, args): Promise<ClientSafeJob[]> => {
    const ownerId = await readOwnerId(ctx, args.instanceId);
    if (ownerId === null) return [];

    const projectAgent = await ctx.runQuery(internal.project_agents.getByInstanceAndWorkspaceKey, {
      instanceId: args.instanceId,
      workspaceKey: args.workspaceKey,
    });
    const templateId = projectAgent?.templateId;
    if (!templateId) return [];

    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_instance_template", (q) => q.eq("instanceId", args.instanceId).eq("templateId", templateId))
      .take(50);
    const ownedJobs = jobs.filter((job) => job.ownerId === ownerId);
    return ownedJobs.map((job) => ({
      _id: job._id,
      templateId: job.templateId,
      jobType: job.type,
      agentName: jobLabel(job.type),
      state: job.state,
      lastRunAt: job.lastRunAt,
      lastOutcome: job.lastOutcome,
      lastError: job.lastError,
    }));
  },
});

/**
 * Lists the Runs of a generic Job for the Agent Logs page, newest first,
 * ownership-scoped and stripped of `sessionKey` exactly like
 * `listRunsForMission`.
 */
export const listRunsForJob = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args): Promise<ClientSafeJobRun[]> => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return [];
    const ownerId = await readOwnerId(ctx, job.instanceId);
    if (ownerId !== job.ownerId) return [];

    const runs = await ctx.db.query("runs").withIndex("by_job", (q) => q.eq("jobId", job._id)).order("desc").take(100);

    return runs.map((run) => ({
      _id: run._id,
      jobId: job._id,
      status: run.status,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      errorMessage: run.errorMessage,
    }));
  },
});
