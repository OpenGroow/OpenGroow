import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel.js";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server.js";
import { effectivePublishTargets, unusableTargets } from "./publication_targets.js";
import { publicationStatusV } from "./publisher_schema.js";
import { ownerIdFor, readOwnerId } from "./instance_ownership.js";
import { markMissionDone } from "./missions.js";
import { assertValidPublishAt, effectivePublishAt } from "./publish_at.js";

// Publications (ADR-069, docs/domain/publishing.md): the tracked outcome of
// sending one Publishable to one Publish target. One row per (Mission, target).
// A Mission is `done` when all its Publications are `published`.

export const listForMission = query({
  args: { missionId: v.id("missions") },
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission || !(await readOwnerId(ctx, mission.instanceId))) return [];
    const rows = await ctx.db
      .query("publications")
      .withIndex("by_mission", (q) => q.eq("missionId", args.missionId))
      .collect();
    return rows.map((row) => ({
      id: row._id,
      target: row.target,
      status: row.status,
      externalId: row.externalId,
      externalUrl: row.externalUrl,
      scheduledAt: row.scheduledAt,
      error: row.error,
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
    const payload = mission.payload && typeof mission.payload === "object" ? mission.payload : {};
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
    if (args.publishAt !== null) assertValidPublishAt({ publishAt: args.publishAt });
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
    return {
      target: targets[0] ?? null,
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

    const now = Date.now();
    const toSend = [];
    const skipped: string[] = [];
    for (const target of targets) {
      const mapping = publisher.targets.find((t) => t.target === target)!;
      const existing = await publicationFor(ctx, args.missionId, target);
      if (existing && existing.status !== "failed") {
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

/** Records the adapter's answer, and completes the Mission once every Publication is published. */
export const finish = internalMutation({
  args: {
    publicationId: v.id("publications"),
    status: publicationStatusV,
    externalId: v.optional(v.string()),
    externalUrl: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { publicationId, ...fields } = args;
    const publication = await ctx.db.get(publicationId);
    if (!publication) throw new Error("Publication not found");
    await ctx.db.patch(publicationId, { ...fields, updatedAt: Date.now() });

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
