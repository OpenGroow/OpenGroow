import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { ownerIdFor, readOwnerId } from "./instance_ownership.js";

const brandCoreRubricValidators = {
  audience: v.optional(v.string()),
  tone: v.optional(v.string()),
  offer: v.optional(v.string()),
  positioning: v.optional(v.string()),
  editorialRules: v.optional(v.string()),
  constraints: v.optional(v.string()),
  avoid: v.optional(v.string()),
  notes: v.optional(v.string()),
};

function brandCoreRubrics(args: {
  audience?: string;
  tone?: string;
  offer?: string;
  positioning?: string;
  editorialRules?: string;
  constraints?: string;
  avoid?: string;
  notes?: string;
}) {
  return {
    audience: args.audience,
    tone: args.tone,
    offer: args.offer,
    positioning: args.positioning,
    editorialRules: args.editorialRules,
    constraints: args.constraints,
    avoid: args.avoid,
    notes: args.notes,
  };
}

export const get = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await readOwnerId(ctx, args.instanceId);
    if (!ownerId) return null;

    return await ctx.db
      .query("brandCores")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .unique();
  },
});

export const upsert = mutation({
  args: {
    instanceId: v.string(),
    ...brandCoreRubricValidators,
  },
  handler: async (ctx, args) => {
    await ownerIdFor(ctx, args.instanceId);

    const now = Date.now();
    const existing = await ctx.db
      .query("brandCores")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...brandCoreRubrics(args),
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("brandCores", {
      instanceId: args.instanceId,
      ...brandCoreRubrics(args),
      updatedAt: now,
    });
  },
});
