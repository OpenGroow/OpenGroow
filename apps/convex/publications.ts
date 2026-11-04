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

/** What the review page needs to show and gate `publish`. */
export const reviewState = internalQuery({
  args: { missionId: v.id("missions"), declaredTargets: v.array(v.string()) },
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found");
    const target = effectivePublishTarget(mission.payload, args.declaredTargets);
    const publisher = await ctx.db
      .query("publishers")
      .withIndex("by_instance", (q) => q.eq("instanceId", mission.instanceId))
      .unique();
    const mapped = Boolean(target && publisher?.targets.some((t) => t.target === target && t.channelId));
    const publications = await ctx.db
      .query("publications")
      .withIndex("by_mission", (q) => q.eq("missionId", args.missionId))
      .collect();
    return {
      target: target ?? null,
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
  args: { missionId: v.id("missions"), declaredTargets: v.array(v.string()) },
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found");
    const target = effectivePublishTarget(mission.payload, args.declaredTargets);
    if (!target || !args.declaredTargets.includes(target)) {
      throw new Error(`Publish target "${target ?? ""}" is not one this Mission type may use`);
    }
    const publishable = (mission.lastResult?.artifact ?? mission.lastArtifact)?.publishable;
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
