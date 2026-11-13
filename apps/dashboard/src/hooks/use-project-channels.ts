"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

/** One of the Project's Publishers (ADR-075), as the dashboard sees it: never its API key. */
export type ProjectPublisher = FunctionReturnType<typeof api.publishers.list>[number];

/** A channel of one of the Project's Publishers, with the Publisher that carries it. */
export type ProjectChannel = ProjectPublisher["targets"][number] & {
  /** The adapter of its Publisher: its capabilities come from that package. */
  adapter: string;
  /** The URL of its Publisher (it serves the platform logos). */
  publisherUrl: string;
};

/** The channels of all the Project's Publishers, in the Publishers' order. A channel key is unique across them. */
export function channelsOf(publishers: readonly ProjectPublisher[]): ProjectChannel[] {
  return publishers.flatMap((p) => p.targets.map((t) => ({ ...t, adapter: p.adapter, publisherUrl: p.url })));
}

/** The Project's Publishers and their channels; `undefined` while loading. */
export function useProjectChannels(instanceId: string): { publishers: ProjectPublisher[]; channels: ProjectChannel[] } | undefined {
  const publishers = useQuery(api.publishers.list, { instanceId });
  if (publishers === undefined) return undefined;
  return { publishers, channels: channelsOf(publishers) };
}

/**
 * The name of a Publisher, among those of the chosen `targets`, that cannot
 * schedule a post (manifest `scheduling: false`, ADR-074: a GitHub commit is
 * immediate), or undefined when every one can. The date picker is then hidden:
 * the core would refuse a `publishAt`.
 */
export function unschedulablePublisherName(
  channels: readonly ProjectChannel[],
  installed: ReadonlyArray<{ adapter: string; name: string; scheduling?: false }> | undefined,
  targets: readonly string[],
): string | undefined {
  for (const target of targets) {
    const adapter = channels.find((c) => c.target === target)?.adapter;
    const pkg = installed?.find((p) => p.adapter === adapter);
    if (pkg?.scheduling === false) return pkg.name;
  }
  return undefined;
}
