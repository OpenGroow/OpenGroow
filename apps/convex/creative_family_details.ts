import { v } from "convex/values";
import type { Id } from "./_generated/dataModel.js";
import { mutation, type MutationCtx } from "./_generated/server.js";
import { FAMILY_LIST_CAP } from "./creative_families.js";
import { ownerIdFor } from "./instance_ownership.js";

// Create and edit a Creative Family (ADR-082, issue #130). The slug is derived
// from the name once, at creation, and never changes on rename.

/** Lowercase, accent-free, single-spaced: two names that match here are the same name. */
export function normalizeFamilyName(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function slugOf(name: string): string {
  return normalizeFamilyName(name).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function cleanFields(name: string, description: string) {
  const cleanName = name.trim().replace(/\s+/g, " ");
  const cleanDescription = description.trim();
  if (cleanName === "") throw new Error("A Creative Family needs a name");
  if (cleanDescription === "") throw new Error("A Creative Family needs a description of its mechanic");
  return { name: cleanName, description: cleanDescription };
}

/** Throws when another family of the Instance (archived included) has this name. */
async function assertNameFree(ctx: MutationCtx, instanceId: string, name: string, selfId?: Id<"creativeFamilies">) {
  const wanted = normalizeFamilyName(name);
  const families = await ctx.db
    .query("creativeFamilies")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .take(FAMILY_LIST_CAP);
  if (families.some((f) => f._id !== selfId && normalizeFamilyName(f.name) === wanted)) {
    throw new Error(`A Creative Family named "${name}" already exists`);
  }
}

export const create = mutation({
  args: { instanceId: v.string(), name: v.string(), description: v.string() },
  handler: async (ctx, args) => {
    await ownerIdFor(ctx, args.instanceId);
    const fields = cleanFields(args.name, args.description);
    const slug = slugOf(fields.name);
    if (slug === "") throw new Error("The name must contain letters or digits");
    await assertNameFree(ctx, args.instanceId, fields.name);
    const sameSlug = await ctx.db
      .query("creativeFamilies")
      .withIndex("by_instance_slug", (q) => q.eq("instanceId", args.instanceId).eq("slug", slug))
      .first();
    if (sameSlug) throw new Error(`A Creative Family with the slug "${slug}" already exists`);
    return await ctx.db.insert("creativeFamilies", { instanceId: args.instanceId, slug, status: "active", ...fields });
  },
});

export const update = mutation({
  args: { instanceId: v.string(), familyId: v.id("creativeFamilies"), name: v.string(), description: v.string() },
  handler: async (ctx, args) => {
    await ownerIdFor(ctx, args.instanceId);
    const family = await ctx.db.get(args.familyId);
    if (!family || family.instanceId !== args.instanceId) throw new Error("Creative Family not found");
    const fields = cleanFields(args.name, args.description);
    await assertNameFree(ctx, args.instanceId, fields.name, args.familyId);
    await ctx.db.patch(args.familyId, fields);
    return null;
  },
});
