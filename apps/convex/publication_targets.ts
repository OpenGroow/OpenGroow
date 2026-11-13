// Which Publish targets a Mission goes to (ADR-069, docs/domain/publishing.md).
// A Publish target is the key of one channel entry of one of the Project's
// Publishers (ADR-075): the key alone says which Publisher carries it.
// Shared by the Convex functions and the review projection.

import { publishDeclarationFor } from "@opengroow/agent-templates";
import type { QueryCtx } from "./_generated/server.js";
import { capabilityFor, missingOptions, notConfiguredReason } from "@opengroow/publisher-sdk";
import { publisherMetaOf } from "./publisher_packages.js";
import { getTemplateRegistry } from "./template_registry.js";
import { effectivePublishAt } from "./publish_at.js";
import { allChannels, channelOf, projectPublishers, publishersOf, type ProjectPublisher } from "./project_publishers.js";

/** The Publish targets of a Mission or Schedule payload: `payload.publishTargets`,
 * chosen by the human among the channels of the Project's Publishers. Agents never choose them,
 * and there is no default. */
export function effectivePublishTargets(payload: unknown): string[] {
  const many = (payload as { publishTargets?: unknown } | null | undefined)?.publishTargets;
  if (!Array.isArray(many)) return [];
  return [...new Set(many.filter((t): t is string => typeof t === "string" && t !== ""))];
}

/** Names the keys of `targets` that are not (mapped) channels of the Project's Publishers (`allChannels`). */
export function unusableTargets(
  publisherTargets: ReadonlyArray<{ target: string; channelId?: string }> | undefined,
  targets: readonly string[],
): { unknown: string[]; unmapped: string[] } {
  const entries = publisherTargets ?? [];
  return {
    unknown: targets.filter((k) => !entries.some((t) => t.target === k)),
    unmapped: targets.filter((k) => entries.some((t) => t.target === k && !t.channelId)),
  };
}

/**
 * The targets whose channel lacks a required option of its Publisher's package
 * (`channel-options.json`, `required: true`, ADR-075): they cannot be published to yet.
 */
export async function notConfiguredTargets(
  ctx: QueryCtx,
  publishers: readonly ProjectPublisher[],
  targets: readonly string[],
): Promise<Array<{ target: string; reason: string }>> {
  const result = [];
  for (const target of targets) {
    const found = channelOf(publishers, target);
    if (!found) continue;
    const options = (await publisherMetaOf(ctx, found.publisher.adapter))?.channelOptions;
    const reason = notConfiguredReason(missingOptions(options, found.channel.channelService, found.channel.settings));
    if (reason) result.push({ target, reason });
  }
  return result;
}

/** Rejects a payload whose `publishTargets` name a channel that is on none of
 * the Project's Publishers. Mutations have no Template registry, so this is the
 * only check they can make; mapping and the API key are checked at publish time. */
export async function assertKnownPublishTargets(ctx: QueryCtx, instanceId: string, payload: unknown): Promise<void> {
  const targets = effectivePublishTargets(payload);
  if (targets.length === 0) return;
  const { unknown } = unusableTargets(allChannels(await projectPublishers(ctx, instanceId)), targets);
  if (unknown.length > 0) throw new Error(unknownChannelsMessage(unknown));
}

/** The error of keys that name no channel of the Project. */
export function unknownChannelsMessage(unknown: readonly string[]): string {
  return `Unknown channel ${unknown.map((t) => `"${t}"`).join(", ")}: it is not on the Project's Publishers`;
}

/** Refuses targets whose channel cannot carry `kind` (capabilities are owned by the adapter of the channel's
 * Publisher) or is on a platform the Mission type does not publish to (`platforms`, ADR-073). `uncertain` is allowed. */
export async function assertChannelsSupportKind(
  ctx: QueryCtx,
  publishers: readonly ProjectPublisher[],
  targets: readonly string[],
  kind: string,
  platforms?: readonly string[],
): Promise<void> {
  const refused = [];
  for (const target of targets) {
    const found = channelOf(publishers, target);
    if (!found) continue;
    // Capabilities are data of the installed package; a Publisher whose package is gone has none: every pair is `uncertain`.
    const capabilities = (await publisherMetaOf(ctx, found.publisher.adapter))?.capabilities;
    const capability = capabilityFor(capabilities, found.channel.channelService, kind, platforms);
    if (capability.level === "unsupported") refused.push({ target, capability });
  }
  if (refused.length > 0) {
    throw new Error(refused.map(({ target, capability }) => `${capability.reason} (channel "${target}")`).join("; "));
  }
}

/** Same check at creation/edit of a Mission or Schedule payload: the kind comes from the Mission type's `publish` declaration. */
export async function assertPayloadChannelsSupportMissionType(
  ctx: QueryCtx,
  args: { instanceId: string; templateId: string; type: string; payload: unknown },
): Promise<void> {
  const targets = effectivePublishTargets(args.payload);
  if (targets.length === 0) return;
  const template = await getTemplateRegistry(ctx).resolve(args.instanceId, args.templateId);
  const declaration = publishDeclarationFor(template?.manifest, args.type);
  if (!declaration) return;
  await assertChannelsSupportKind(ctx, await projectPublishers(ctx, args.instanceId), targets, declaration.kind, declaration.platforms);
}

/** Refuses a `publishAt` on channels of a Publisher that cannot schedule (manifest `scheduling: false`, ADR-074:
 * a GitHub commit is immediate). A date already past is not a schedule (it publishes now) and passes. */
export async function assertSchedulable(
  ctx: QueryCtx,
  publishers: readonly ProjectPublisher[],
  targets: readonly string[],
  publishAt: number | undefined,
): Promise<void> {
  if (publishAt === undefined || targets.length === 0) return;
  for (const publisher of publishersOf(publishers, targets)) {
    const meta = await publisherMetaOf(ctx, publisher.adapter);
    if (meta?.scheduling !== false) continue;
    const channels = targets.filter((t) => publisher.targets.some((entry) => entry.target === t)).map((t) => `"${t}"`).join(", ");
    throw new Error(`${meta.name} cannot schedule a post: remove the publication date (channel ${channels})`);
  }
}

/** Same check on a Mission or Schedule payload: its `publishTargets` and its `publishAt`. */
export async function assertPayloadSchedulable(ctx: QueryCtx, instanceId: string, payload: unknown): Promise<void> {
  const targets = effectivePublishTargets(payload);
  const publishAt = effectivePublishAt(payload, Date.now());
  if (targets.length === 0 || publishAt === undefined) return;
  await assertSchedulable(ctx, await projectPublishers(ctx, instanceId), targets, publishAt);
}
