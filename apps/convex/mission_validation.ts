import type { QueryCtx } from "./_generated/server.js";
import type { Doc } from "./_generated/dataModel.js";
import { assertValidPublishAt } from "./publish_at.js";
import { assertKnownPublishTargets, assertPayloadChannelsSupportMissionType, assertPayloadSchedulable } from "./publication_targets.js";

export type CandidateMission = { instanceId: string; templateId: string; type: string; payload: unknown };

/** The active projectAgent that executes Missions of a Template, or a thrown error.
 * Shared by the validation and by the Run dispatch so both refuse with the same messages. */
export async function activeProjectAgent(
  ctx: QueryCtx,
  instanceId: string,
  templateId: string,
): Promise<Doc<"projectAgents"> & { openclawAgentName: string }> {
  const projectAgent = await ctx.db
    .query("projectAgents")
    .withIndex("by_instance_template", (q) => q.eq("instanceId", instanceId).eq("templateId", templateId))
    .unique();
  if (!projectAgent || projectAgent.status !== "active") {
    throw new Error(`projectAgent for ${templateId} is not active`);
  }
  if (!projectAgent.openclawAgentName) {
    throw new Error("projectAgent has no openclawAgentName");
  }
  return projectAgent as Doc<"projectAgents"> & { openclawAgentName: string };
}

/** The rules that decide whether a Mission can be created (publication date, known and compatible channels,
 * scheduling, active agent of the Mission type). Read-only: it creates nothing, so it checks a manual
 * Mission and a candidate Mission (one not created yet) with the same rules. Throws on the first refusal. */
export async function assertMissionCreatable(ctx: QueryCtx, candidate: CandidateMission): Promise<void> {
  assertValidPublishAt(candidate.payload);
  await assertKnownPublishTargets(ctx, candidate.instanceId, candidate.payload);
  await assertPayloadChannelsSupportMissionType(ctx, candidate);
  await assertPayloadSchedulable(ctx, candidate.instanceId, candidate.payload);
  await activeProjectAgent(ctx, candidate.instanceId, candidate.templateId);
}
