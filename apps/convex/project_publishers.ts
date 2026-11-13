// The Publishers of a Project (ADR-075): several, at most one per adapter. A
// Publish target key (`<platform>:<handle>`) is unique across all of them, so a
// key alone names one channel and the Publisher that carries it.

import type { Doc } from "./_generated/dataModel.js";
import type { QueryCtx } from "./_generated/server.js";

/** A Project has a handful of Publishers (one per installed adapter): a bound, not a page. */
export const MAX_PUBLISHERS_PER_PROJECT = 20;

export type ProjectPublisher = Doc<"publishers">;
export type PublisherChannelEntry = ProjectPublisher["targets"][number];

/** Every Publisher of the Project, oldest first. */
export async function projectPublishers(ctx: Pick<QueryCtx, "db">, instanceId: string): Promise<ProjectPublisher[]> {
  return await ctx.db
    .query("publishers")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .take(MAX_PUBLISHERS_PER_PROJECT);
}

/** The Project's Publisher backed by `adapter`, or null. */
export async function projectPublisher(ctx: Pick<QueryCtx, "db">, instanceId: string, adapter: string): Promise<ProjectPublisher | null> {
  return await ctx.db
    .query("publishers")
    .withIndex("by_instance_and_adapter", (q) => q.eq("instanceId", instanceId).eq("adapter", adapter))
    .unique();
}

/** The channel entry a Publish target key names, and the Publisher it is on. */
export function channelOf(
  publishers: readonly ProjectPublisher[],
  target: string,
): { publisher: ProjectPublisher; channel: PublisherChannelEntry } | undefined {
  for (const publisher of publishers) {
    const channel = publisher.targets.find((t) => t.target === target);
    if (channel) return { publisher, channel };
  }
  return undefined;
}

/** The channel entries of all the Project's Publishers. */
export function allChannels(publishers: readonly ProjectPublisher[]): PublisherChannelEntry[] {
  return publishers.flatMap((p) => p.targets);
}

/** The Publishers carrying `targets` (each once), in the Project's order. Unknown keys are ignored. */
export function publishersOf(publishers: readonly ProjectPublisher[], targets: readonly string[]): ProjectPublisher[] {
  return publishers.filter((p) => p.targets.some((t) => targets.includes(t.target)));
}
