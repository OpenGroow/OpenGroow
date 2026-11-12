// Which Publish targets a Mission goes to (ADR-069, docs/domain/publishing.md).
// A Publish target is the key of one channel entry of the Project's Publisher.
// Shared by the Convex functions and the review projection.

import { publishDeclarationFor } from "@opengroow/agent-templates";
import type { QueryCtx } from "./_generated/server.js";
import { capabilityFor } from "@opengroow/publisher-sdk";
import { publisherMetaOf } from "./publisher_packages.js";
import { getTemplateRegistry } from "./template_registry.js";
import { effectivePublishAt } from "./publish_at.js";

/** The Publish targets of a Mission or Schedule payload: `payload.publishTargets`,
 * chosen by the human among the Publisher's channels. Agents never choose them,
 * and there is no default. */
export function effectivePublishTargets(payload: unknown): string[] {
  const many = (payload as { publishTargets?: unknown } | null | undefined)?.publishTargets;
  if (!Array.isArray(many)) return [];
  return [...new Set(many.filter((t): t is string => typeof t === "string" && t !== ""))];
}

/** Names the keys of `targets` that are not (mapped) channels of the Publisher. */
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

/** Rejects a payload whose `publishTargets` name a channel that is not on the
 * Project's Publisher. Mutations have no Template registry, so this is the
 * only check they can make; mapping and the API key are checked at publish time. */
export async function assertKnownPublishTargets(ctx: QueryCtx, instanceId: string, payload: unknown): Promise<void> {
  const targets = effectivePublishTargets(payload);
  if (targets.length === 0) return;
  const publisher = await ctx.db
    .query("publishers")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .unique();
  const { unknown } = unusableTargets(publisher?.targets, targets);
  if (unknown.length > 0) {
    throw new Error(`Unknown channel ${unknown.map((t) => `"${t}"`).join(", ")}: it is not on the Project's Publisher`);
  }
}

/** Refuses targets whose channel cannot carry `kind` (capabilities are owned by the adapter) or is on a platform the
 * Mission type does not publish to (`platforms`, ADR-073). `uncertain` is allowed. */
export async function assertChannelsSupportKind(
  ctx: QueryCtx,
  publisher: { adapter: string; targets: ReadonlyArray<{ target: string; channelService?: string }> } | null | undefined,
  targets: readonly string[],
  kind: string,
  platforms?: readonly string[],
): Promise<void> {
  if (!publisher) return;
  // Capabilities are data of the installed package; a Publisher whose package is gone has none: every pair is `uncertain`.
  const capabilities = (await publisherMetaOf(ctx, publisher.adapter))?.capabilities;
  const refused = targets
    .map((t) => publisher.targets.find((entry) => entry.target === t))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
    .map((entry) => ({ target: entry.target, capability: capabilityFor(capabilities, entry.channelService, kind, platforms) }))
    .filter(({ capability }) => capability.level === "unsupported");
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
  const publisher = await ctx.db
    .query("publishers")
    .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
    .unique();
  await assertChannelsSupportKind(ctx, publisher, targets, declaration.kind, declaration.platforms);
}

/** Refuses a `publishAt` on channels of a Publisher that cannot schedule (manifest `scheduling: false`, ADR-074:
 * a GitHub commit is immediate). A date already past is not a schedule (it publishes now) and passes. */
export async function assertSchedulable(
  ctx: QueryCtx,
  publisher: { adapter: string } | null | undefined,
  targets: readonly string[],
  publishAt: number | undefined,
): Promise<void> {
  if (!publisher || publishAt === undefined || targets.length === 0) return;
  const meta = await publisherMetaOf(ctx, publisher.adapter);
  if (meta?.scheduling !== false) return;
  const channels = targets.map((t) => `"${t}"`).join(", ");
  throw new Error(`${meta.name} cannot schedule a post: remove the publication date (channel ${channels})`);
}

/** Same check on a Mission or Schedule payload: its `publishTargets` and its `publishAt`. */
export async function assertPayloadSchedulable(ctx: QueryCtx, instanceId: string, payload: unknown): Promise<void> {
  const targets = effectivePublishTargets(payload);
  const publishAt = effectivePublishAt(payload, Date.now());
  if (targets.length === 0 || publishAt === undefined) return;
  const publisher = await ctx.db
    .query("publishers")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .unique();
  await assertSchedulable(ctx, publisher, targets, publishAt);
}
