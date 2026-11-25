import { v } from "convex/values";
import { internalQuery } from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";
import { CONTEXT_PROVIDER_RENDERERS } from "./mission_dispatcher/context_providers.js";
import { CONTENT_PLANNING_JOB_TYPE, runtimeOf, type ContentPlanningPins } from "./content_planning_shared.js";

// What dispatching a Content Planning Run needs (ADR-086): the text the Agent reads and the inputs loaded from the
// Run, which pins its own period and targets.

/** The text a Content Planning Run reads: the pinned period and targets (context provider) and what to do with them. */
export function buildContentPlanningRunFile(pins: ContentPlanningPins, feedback?: readonly string[]): string {
  const section = CONTEXT_PROVIDER_RENDERERS["content-planning-targets"](pins);
  const lines = [
    "# Content Planning",
    "",
    "This session is a Content Planning Job, not a Mission: propose a Content Plan for the period below and return the result described in your Job instructions (jobs/content-planning.md). Nothing here creates a Mission.",
    "",
    section ?? "",
  ];
  if (feedback && feedback.length > 0) {
    lines.push("", "## Previous attempt feedback", "", "Your previous result was refused. Fix each of these reasons and return the whole Content Plan again, for the same period and targets:", "", ...feedback.map((reason) => `- ${reason}`));
  }
  return lines.join("\n");
}

export const isContentPlanningRun = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => (await ctx.db.get(args.runId))?.contentPlanning !== undefined,
});

/** What dispatching a Run needs; the pins come from the Run itself, never recomputed from the Job. */
export const loadDispatchInputs = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    const jobId = (run as (typeof run & { jobId?: Id<"jobs"> }) | null)?.jobId;
    if (!run || !jobId || !run.contentPlanning) return null;
    const job = await ctx.db.get(jobId);
    if (!job || job.type !== CONTENT_PLANNING_JOB_TYPE) return null;
    const agent = await ctx.db
      .query("projectAgents")
      .withIndex("by_instance_template", (q) => q.eq("instanceId", run.instanceId).eq("templateId", job.templateId))
      .unique();
    if (!agent?.workspaceKey) return null;
    return {
      run: { _id: run._id, agentName: run.agentName, sessionKey: run.sessionKey },
      workspaceKey: agent.workspaceKey,
      instanceId: run.instanceId,
      templateId: job.templateId,
      jobId: job._id,
      pins: run.contentPlanning,
      // The reasons of the refused result, for a retry only.
      feedback: run.resumedFromRunId && Array.isArray(runtimeOf(job).inFlightErrors) && runtimeOf(job).inFlightRunId === run._id
        ? (runtimeOf(job).inFlightErrors as string[])
        : undefined,
    };
  },
});

