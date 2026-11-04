import { v } from "convex/values";
import { isValidPublishTarget } from "@opengroow/agent-templates";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server.js";
import { ownerIdFor, readOwnerId } from "./instance_ownership.js";
import { markMissionDone } from "./missions.js";

// Publications (ADR-069, docs/domain/publishing.md): the tracked outcome of
// sending one Publishable to one Publish target. One row per (Mission, target).
// A Mission is `done` when all its Publications are `published`.

/** The Publish target of a Mission: the one the human chose in the review, else
 * the first target its Mission type declares. Agents never choose it. */
export function effectivePublishTarget(payload: unknown, declaredTargets: readonly string[]): string | undefined {
  const chosen = (payload as { publishTarget?: unknown } | null | undefined)?.publishTarget;
  return typeof chosen === "string" && chosen !== "" ? chosen : declaredTargets[0];
}

/** All Publish targets of a Mission: `payload.publishTargets` when the human
 * chose several in the review, else the single target (see above). */
export function effectivePublishTargets(payload: unknown, declaredTargets: readonly string[]): string[] {
  const many = (payload as { publishTargets?: unknown } | null | undefined)?.publishTargets;
  if (Array.isArray(many)) {
    const targets = [...new Set(many.filter((t): t is string => typeof t === "string" && t !== ""))];
    if (targets.length > 0) return targets;
  }
  const single = effectivePublishTarget(payload, declaredTargets);
  return single ? [single] : [];
}

const publicationStatusV = v.union(
  v.literal("pending"),
  v.literal("scheduled"),
  v.literal("published"),
  v.literal("failed"),
);

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

/** The human changes where a Mission goes, before publishing. */
export const setPublishTarget = mutation({
  args: { missionId: v.id("missions"), target: v.string() },
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found");
    const ownerId = await ownerIdFor(ctx, mission.instanceId);
    if (mission.ownerId !== ownerId) throw new Error("Forbidden");
    if (mission.status !== "to_validate" && mission.status !== "approved") {
      throw new Error(`The Publish target can only be changed during review, got: "${mission.status}"`);
    }
    if (!isValidPublishTarget(args.target)) throw new Error(`Invalid Publish target "${args.target}"`);
    const payload = mission.payload && typeof mission.payload === "object" ? mission.payload : {};
    await ctx.db.patch(args.missionId, {
      payload: { ...(payload as Record<string, unknown>), publishTarget: args.target },
      updatedAt: Date.now(),
    });
  },
});

/** The human sends a Mission to several targets at once (one Publication each). */
export const setPublishTargets = mutation({
  args: { missionId: v.id("missions"), targets: v.array(v.string()) },
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found");
    const ownerId = await ownerIdFor(ctx, mission.instanceId);
    if (mission.ownerId !== ownerId) throw new Error("Forbidden");
    if (mission.status !== "to_validate" && mission.status !== "approved") {
      throw new Error(`The Publish targets can only be changed during review, got: "${mission.status}"`);
    }
    if (args.targets.length === 0) throw new Error("At least one Publish target is required");
    for (const target of args.targets) {
      if (!isValidPublishTarget(target)) throw new Error(`Invalid Publish target "${target}"`);
    }
    const payload = mission.payload && typeof mission.payload === "object" ? mission.payload : {};
    await ctx.db.patch(args.missionId, {
      payload: { ...(payload as Record<string, unknown>), publishTargets: [...new Set(args.targets)] },
      updatedAt: Date.now(),
    });
  },
});

/** What the review page needs to show and gate `publish`. */
export const reviewState = internalQuery({
  args: { missionId: v.id("missions"), declaredTargets: v.array(v.string()) },
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found");
    const target = effectivePublishTarget(mission.payload, args.declaredTargets);
    const targets = effectivePublishTargets(mission.payload, args.declaredTargets);
    const publisher = await ctx.db
      .query("publishers")
      .withIndex("by_instance", (q) => q.eq("instanceId", mission.instanceId))
      .unique();
    const mapped =
      targets.length > 0 &&
      targets.every((name) => publisher?.targets.some((t) => t.target === name && t.channelId));
    const publications = await ctx.db
      .query("publications")
      .withIndex("by_mission", (q) => q.eq("missionId", args.missionId))
      .collect();
    return {
      target: targets[0] ?? target ?? null,
      targets,
      declaredTargets: args.declaredTargets,
      mapped,
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
 * Starts publishing a Mission: validates the target, creates (or, after a
 * failure, reuses) the Publication as `pending`, and returns what the adapter
 * needs. Throws when nothing can be published; no Publication is created then.
 */
export const begin = internalMutation({
  args: {
    missionId: v.id("missions"),
    declaredTargets: v.array(v.string()),
    /** Retry of one existing Publication: use its target instead of the Mission's current one. */
    target: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found");
    const target = args.target ?? effectivePublishTarget(mission.payload, args.declaredTargets);
    if (!target || !args.declaredTargets.includes(target)) {
      throw new Error(`Publish target "${target ?? ""}" is not one this Mission type may use`);
    }
    const resultArtifact = mission.lastResult && "artifact" in mission.lastResult ? mission.lastResult.artifact : undefined;
    const publishable = (resultArtifact ?? mission.lastArtifact)?.publishable;
    if (!publishable) throw new Error("No Publishable available for this mission");

    const publisher = await ctx.db
      .query("publishers")
      .withIndex("by_instance", (q) => q.eq("instanceId", mission.instanceId))
      .unique();
    const mapping = publisher?.targets.find((t) => t.target === target);
    if (!publisher || !mapping?.channelId) {
      throw new Error(`Publish target "${target}" is not configured: map it on the Publishers page`);
    }
    if (!publisher.apiKey) throw new Error("The Publisher has no API key: set it on the Publishers page");

    const now = Date.now();
    const existing = await ctx.db
      .query("publications")
      .withIndex("by_mission_target", (q) => q.eq("missionId", args.missionId).eq("target", target))
      .unique();
    if (existing && existing.status !== "failed") {
      throw new Error(`Publication to "${target}" is already ${existing.status}`);
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
    return {
      publicationId: publicationId!,
      connection: { adapter: publisher.adapter, url: publisher.url, apiKey: publisher.apiKey },
      channelId: mapping.channelId,
      settings: mapping.settings,
      publishable: publishable as Record<string, unknown>,
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
    declaredTargets: v.array(v.string()),
    /** Retry of one existing Publication: only that target, whatever the Mission's current targets are. */
    target: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found");
    const targets = args.target ? [args.target] : effectivePublishTargets(mission.payload, args.declaredTargets);
    if (targets.length === 0) throw new Error(`Publish target "" is not one this Mission type may use`);
    for (const target of targets) {
      if (!args.declaredTargets.includes(target)) {
        throw new Error(`Publish target "${target}" is not one this Mission type may use`);
      }
    }
    const resultArtifact = mission.lastResult && "artifact" in mission.lastResult ? mission.lastResult.artifact : undefined;
    const publishable = (resultArtifact ?? mission.lastArtifact)?.publishable;
    if (!publishable) throw new Error("No Publishable available for this mission");

    const publisher = await ctx.db
      .query("publishers")
      .withIndex("by_instance", (q) => q.eq("instanceId", mission.instanceId))
      .unique();
    if (!publisher) throw new Error("No Publisher is configured: set one up on the Publishers page");
    for (const target of targets) {
      if (!publisher.targets.find((t) => t.target === target)?.channelId) {
        throw new Error(`Publish target "${target}" is not configured: map it on the Publishers page`);
      }
    }
    if (!publisher.apiKey) throw new Error("The Publisher has no API key: set it on the Publishers page");

    const now = Date.now();
    const toSend = [];
    const skipped: string[] = [];
    for (const target of targets) {
      const mapping = publisher.targets.find((t) => t.target === target)!;
      const existing = await ctx.db
        .query("publications")
        .withIndex("by_mission_target", (q) => q.eq("missionId", args.missionId).eq("target", target))
        .unique();
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
        settings: mapping.settings,
      });
    }
    if (toSend.length === 0) throw new Error(`Publication to ${skipped.join(", ")}`);
    return {
      connection: { adapter: publisher.adapter, url: publisher.url, apiKey: publisher.apiKey },
      publishable: publishable as Record<string, unknown>,
      publications: toSend,
    };
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
