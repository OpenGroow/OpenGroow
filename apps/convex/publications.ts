import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel.js";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server.js";
import { publishableForPlatform } from "./publishable.js";
import { assertChannelsSupportKind, assertPayloadChannelsSupportMissionType, assertPayloadSchedulable, assertSchedulable, effectivePublishTargets, unusableTargets } from "./publication_targets.js";
import { publicationStatusV } from "./publisher_schema.js";
import { publicNotificationOf, scheduleOnPublished } from "./publication_notifications.js";
import { ownerIdFor, readOwnerId } from "./instance_ownership.js";
import { markMissionDone } from "./missions.js";
import { renderPostUrl } from "@opengroow/publisher-sdk";
import { publishDeclarationFor } from "@opengroow/agent-templates";
import { getTemplateRegistry } from "./template_registry.js";
import { publisherMetaOf } from "./publisher_packages.js";
import { assertValidPublishAt, effectivePublishAt } from "./publish_at.js";

// Publications (ADR-069, docs/domain/publishing.md): the tracked outcome of
// sending one Publishable to one Publish target. One row per (Mission, target).
// A Mission is `done` when all its Publications are `published`.

/** The platform and account of a target, as the Publisher knows them (for the Publications list). */
function channelInfo(
  publisher: Doc<"publishers"> | null,
  target: string,
): { channelService?: string; channelProfile?: string; channelName?: string } {
  const channel = publisher?.targets.find((t) => t.target === target);
  if (!channel) return {};
  return {
    channelService: channel.channelService,
    ...(channel.channelProfile ? { channelProfile: channel.channelProfile } : {}),
    ...(channel.channelName ? { channelName: channel.channelName } : {}),
  };
}

export const listForMission = query({
  args: { missionId: v.id("missions") },
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission || !(await readOwnerId(ctx, mission.instanceId))) return [];
    const rows = await ctx.db
      .query("publications")
      .withIndex("by_mission", (q) => q.eq("missionId", args.missionId))
      .collect();
    const publisher = await ctx.db
      .query("publishers")
      .withIndex("by_instance", (q) => q.eq("instanceId", mission.instanceId))
      .unique();
    const plugin = publisher ? await publisherMetaOf(ctx, publisher.adapter) : null;
    return rows.map((row) => ({
      id: row._id,
      target: row.target,
      // For the platform logo and name (the Publisher serves the logo).
      ...(publisher ? { publisherUrl: publisher.url } : {}),
      ...channelInfo(publisher, row.target),
      status: row.status,
      externalId: row.externalId,
      externalUrl: row.externalUrl,
      // Where to open the post in the Publisher's own UI (e.g. Postiz).
      ...(plugin?.postUrl && publisher && row.externalId
        ? { managerUrl: renderPostUrl(plugin.postUrl, { url: publisher.url }, row.externalId), managerName: plugin.name }
        : {}),
      scheduledAt: row.scheduledAt,
      error: row.error,
      ...publicNotificationOf(row, Date.now()),
    }));
  },
});

/**
 * The human chooses the Publish targets of a Mission during review: one or
 * several channels of the Project's Publisher (one Publication each).
 */
export const setTargets = mutation({
  args: { missionId: v.id("missions"), targets: v.array(v.string()) },
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found");
    const ownerId = await ownerIdFor(ctx, mission.instanceId);
    if (mission.ownerId !== ownerId) throw new Error("Forbidden");
    if (mission.status !== "to_validate" && mission.status !== "approved") {
      throw new Error(`The Publish targets can only be changed during review, got: "${mission.status}"`);
    }
    const targets = [...new Set(args.targets)];
    if (targets.length === 0) throw new Error("Choose at least one channel");
    const publisher = await publisherOf(ctx, mission.instanceId);
    const { unknown } = unusableTargets(publisher?.targets, targets);
    if (unknown.length > 0) {
      throw new Error(`Unknown channel ${unknown.map((t) => `"${t}"`).join(", ")}: it is not on the Project's Publisher`);
    }
    await assertPayloadChannelsSupportMissionType(ctx, {
      instanceId: mission.instanceId,
      templateId: mission.templateId,
      type: mission.type,
      payload: { publishTargets: targets },
    });
    const payload = mission.payload && typeof mission.payload === "object" ? mission.payload : {};
    await assertPayloadSchedulable(ctx, mission.instanceId, { ...(payload as Record<string, unknown>), publishTargets: targets });
    await ctx.db.patch(args.missionId, {
      payload: { ...(payload as Record<string, unknown>), publishTargets: targets },
      updatedAt: Date.now(),
    });
  },
});

function optionalPublishAt(payload: unknown): { publishAt?: number } {
  const publishAt = effectivePublishAt(payload, 0);
  return publishAt === undefined ? {} : { publishAt };
}

/** The human schedules the post (epoch ms), or clears it (null) to publish immediately. */
export const setPublishAt = mutation({
  args: { missionId: v.id("missions"), publishAt: v.union(v.number(), v.null()) },
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found");
    const ownerId = await ownerIdFor(ctx, mission.instanceId);
    if (mission.ownerId !== ownerId) throw new Error("Forbidden");
    if (mission.status !== "to_validate" && mission.status !== "approved") {
      throw new Error(`The publication date can only be changed during review, got: "${mission.status}"`);
    }
    if (args.publishAt !== null && !Number.isFinite(args.publishAt)) throw new Error("publishAt must be a timestamp in milliseconds");
    if (args.publishAt !== null) {
      assertValidPublishAt({ publishAt: args.publishAt });
      await assertPayloadSchedulable(ctx, mission.instanceId, { publishTargets: effectivePublishTargets(mission.payload), publishAt: args.publishAt });
    }
    const { publishAt: _previous, ...rest } = (
      mission.payload && typeof mission.payload === "object" ? mission.payload : {}
    ) as Record<string, unknown>;
    await ctx.db.patch(args.missionId, {
      payload: args.publishAt === null ? rest : { ...rest, publishAt: args.publishAt },
      updatedAt: Date.now(),
    });
  },
});

async function publisherOf(ctx: QueryCtx, instanceId: string) {
  return await ctx.db
    .query("publishers")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .unique();
}

/** The Publishable the Mission's latest result (or last Artifact) carries. */
function publishableOf(mission: Doc<"missions">): Record<string, unknown> | undefined {
  const resultArtifact = mission.lastResult && "artifact" in mission.lastResult ? mission.lastResult.artifact : undefined;
  return (resultArtifact ?? mission.lastArtifact)?.publishable as Record<string, unknown> | undefined;
}

async function publicationFor(ctx: QueryCtx, missionId: Id<"missions">, target: string) {
  return await ctx.db
    .query("publications")
    .withIndex("by_mission_target", (q) => q.eq("missionId", missionId).eq("target", target))
    .unique();
}

/** What the review page needs to show and gate `publish`. */
export const reviewState = internalQuery({
  args: { missionId: v.id("missions") },
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found");
    const targets = effectivePublishTargets(mission.payload);
    const publisher = await publisherOf(ctx, mission.instanceId);
    const unmappedTargets = targets.filter(
      (name) => !publisher?.targets.some((t) => t.target === name && t.channelId),
    );
    const publications = await ctx.db
      .query("publications")
      .withIndex("by_mission", (q) => q.eq("missionId", args.missionId))
      .collect();
    const template = await getTemplateRegistry(ctx).resolve(mission.instanceId, mission.templateId);
    const platforms = publishDeclarationFor(template?.manifest, mission.type)?.platforms;
    // Content made of per-platform variants only serves those platforms (ADR-073): a chosen channel on another one
    // would be refused at publish time, so say so now.
    const publishable = publishableOf(mission);
    const unserved = publishable
      ? targets.flatMap((target) => {
          const channel = publisher?.targets.find((t) => t.target === target);
          const result = publishableForPlatform(publishable, channel?.channelService);
          return result.ok ? [] : [{ target, reason: result.error }];
        })
      : [];
    const variants = publishable?.variants;
    const madeFor =
      variants && typeof variants === "object" && publishable.slideUrls === undefined && publishable.imageUrl === undefined
        ? Object.keys(variants)
        : [];
    return {
      target: targets[0] ?? null,
      ...(platforms ? { platforms } : {}),
      ...(madeFor.length > 0 ? { madeFor } : {}),
      ...(unserved.length > 0 ? { unserved } : {}),
      targets,
      mapped: targets.length > 0 && unmappedTargets.length === 0,
      unmappedTargets,
      publisherReady: Boolean(publisher?.apiKey),
      ...optionalPublishAt(mission.payload),
      publications: publications.map((p) => ({
        target: p.target,
        status: p.status,
        externalId: p.externalId,
        externalUrl: p.externalUrl,
        scheduledAt: p.scheduledAt,
        error: p.error,
      })),
    };
  },
});

const ABANDONED_AFTER_MS = 5 * 60_000;

/**
 * Starts publishing a Mission to every one of its Publish targets: validates
 * them all first (nothing is created if one is unusable), creates a `pending`
 * Publication per target up front (so the Mission only completes when all are
 * `published`), and returns what the adapter needs for each target to send.
 * Targets already `published`/`scheduled` are skipped, so a retry only redoes
 * the `failed` ones.
 */
export const beginAll = internalMutation({
  args: {
    missionId: v.id("missions"),
    /** Retry of one existing Publication: only that target, whatever the Mission's current targets are. */
    target: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found");
    const targets = args.target ? [args.target] : effectivePublishTargets(mission.payload);
    if (targets.length === 0) throw new Error("Choose a channel to publish to");
    const publishable = publishableOf(mission);
    if (!publishable) throw new Error("No Publishable available for this mission");

    const publisher = await publisherOf(ctx, mission.instanceId);
    if (!publisher) throw new Error("No Publisher is configured: set one up on the Publishers page");
    const { unknown, unmapped } = unusableTargets(publisher.targets, targets);
    if (unknown.length > 0) {
      throw new Error(`Unknown channel ${unknown.map((t) => `"${t}"`).join(", ")}: it is not on the Project's Publisher`);
    }
    if (unmapped.length > 0) {
      throw new Error(`Channel ${unmapped.map((t) => `"${t}"`).join(", ")} is not configured on the Publishers page`);
    }
    if (!publisher.apiKey) throw new Error("The Publisher has no API key: set it on the Publishers page");
    await assertSchedulable(ctx, publisher, targets, effectivePublishAt(mission.payload, Date.now()));
    if (typeof publishable.kind === "string") {
      const template = await getTemplateRegistry(ctx).resolve(mission.instanceId, mission.templateId);
      const platforms = publishDeclarationFor(template?.manifest, mission.type)?.platforms;
      await assertChannelsSupportKind(ctx, publisher, targets, publishable.kind, platforms);
    }
    // A Publishable made of variants only serves those services: refuse the others before any row exists.
    for (const target of targets) {
      const forChannel = publishableForPlatform(publishable, publisher.targets.find((t) => t.target === target)?.channelService);
      if (!forChannel.ok) throw new Error(`Channel "${target}": ${forChannel.error}`);
    }

    const now = Date.now();
    const toSend = [];
    const skipped: string[] = [];
    for (const target of targets) {
      const mapping = publisher.targets.find((t) => t.target === target)!;
      const existing = await publicationFor(ctx, args.missionId, target);
      // Only one caller can move a row out of failed/uncertain (mutations are
      // serialized): the next one sees `pending` and is refused. A `pending` or
      // `submitting` row whose action died long ago is retried through reconciliation.
      const abandoned =
        existing && (existing.status === "pending" || existing.status === "submitting") && now - existing.updatedAt > ABANDONED_AFTER_MS;
      if (existing && existing.status !== "failed" && existing.status !== "uncertain" && !abandoned) {
        skipped.push(`"${target}" is already ${existing.status}`);
        continue;
      }
      let publicationId = existing?._id;
      if (existing) {
        await ctx.db.patch(existing._id, { status: "pending", error: undefined, updatedAt: now });
      } else {
        publicationId = await ctx.db.insert("publications", {
          missionId: args.missionId,
          instanceId: mission.instanceId,
          target,
          status: "pending",
          createdAt: now,
          updatedAt: now,
        });
      }
      toSend.push({
        publicationId: publicationId!,
        target,
        media: existing?.media ?? [],
        // A previous POST may have reached the service: look for it before sending again.
        reconcile:
          existing && existing.attemptStartedAt !== undefined && existing.externalId === undefined
            ? { attemptStartedAt: existing.attemptStartedAt, attemptDate: existing.attemptDate ?? existing.attemptStartedAt }
            : undefined,
        channelId: mapping.channelId!,
        channelService: mapping.channelService,
        settings: mapping.settings,
      });
    }
    if (toSend.length === 0) throw new Error(`Publication to ${skipped.join(", ")}`);
    return {
      connection: { adapter: publisher.adapter, url: publisher.url, apiKey: publisher.apiKey },
      publishable,
      publications: toSend,
      publishAt: effectivePublishAt(mission.payload, now),
    };
  },
});

/**
 * `autoPublish` could not even start publishing (for example the target is
 * not mapped): records a `failed` Publication with the explicit error for
 * each of the Mission's targets, so the human sees it and can retry it once
 * the Publisher is fixed. A Publication already `failed` (an earlier attempt)
 * gets the latest error; one in any other state is left alone. The Mission
 * stays `approved`. Returns false when the Mission has no target (no channel
 * chosen) to attach the failure to.
 */
export const recordFailure = internalMutation({
  args: { missionId: v.id("missions"), error: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found");
    const targets = effectivePublishTargets(mission.payload);
    const now = Date.now();
    for (const target of targets) {
      const existing = await publicationFor(ctx, args.missionId, target);
      if (existing) {
        if (existing.status === "failed") await ctx.db.patch(existing._id, { error: args.error, updatedAt: now });
        continue;
      }
      await ctx.db.insert("publications", {
        missionId: args.missionId,
        instanceId: mission.instanceId,
        target,
        status: "failed",
        error: args.error,
        createdAt: now,
        updatedAt: now,
      });
    }
    return targets.length > 0;
  },
});

export const getInternal = internalQuery({
  args: { publicationId: v.id("publications") },
  handler: async (ctx, args) => ctx.db.get(args.publicationId),
});

/**
 * Claims a `pending` Publication for the POST that is about to be made: only one
 * caller can move it to `submitting`, and it records the uploaded media and the
 * attempt window the reconciliation will search. False = not yours, do not send.
 */
export const markSubmitting = internalMutation({
  args: {
    publicationId: v.id("publications"),
    media: v.array(v.object({ url: v.string(), id: v.string(), path: v.string() })),
    attemptDate: v.number(),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const publication = await ctx.db.get(args.publicationId);
    if (!publication || publication.status !== "pending") return false;
    const now = Date.now();
    await ctx.db.patch(args.publicationId, {
      status: "submitting",
      media: args.media,
      attemptStartedAt: now,
      attemptDate: args.attemptDate,
      updatedAt: now,
    });
    return true;
  },
});

/** Records the adapter's answer, and completes the Mission once every Publication is published. */
export const finish = internalMutation({
  args: {
    publicationId: v.id("publications"),
    status: publicationStatusV,
    externalId: v.optional(v.string()),
    externalUrl: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    error: v.optional(v.string()),
    /** The service clearly rejected the request: nothing was created, so the attempt window is dropped. */
    rejected: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { publicationId, rejected, ...fields } = args;
    const publication = await ctx.db.get(publicationId);
    if (!publication) throw new Error("Publication not found");
    await ctx.db.patch(publicationId, {
      ...fields,
      ...(rejected ? { attemptStartedAt: undefined, attemptDate: undefined } : {}),
      updatedAt: Date.now(),
    });
    const updated = await ctx.db.get(publicationId);
    if (updated) await scheduleOnPublished(ctx, updated);

    const all = await ctx.db
      .query("publications")
      .withIndex("by_mission", (q) => q.eq("missionId", publication.missionId))
      .collect();
    const mission = await ctx.db.get(publication.missionId);
    if (mission?.status === "approved" && all.every((p) => p.status === "published")) {
      await markMissionDone(ctx, publication.missionId);
    }
  },
});

