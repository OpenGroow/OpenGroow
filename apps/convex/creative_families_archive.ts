import { v } from "convex/values";
import type { Id } from "./_generated/dataModel.js";
import { mutation, type MutationCtx } from "./_generated/server.js";
import { ownerIdFor } from "./instance_ownership.js";

// Archive and unarchive a Creative Family (ADR-082). An archived family is no
// longer offered as a destination (see `isActiveFamily`), but its Sources keep
// their link to it and stay listed under it. Nothing else about it changes.

/** True for a family that can receive Sources: `status` is absent on families written before archiving. */
export function isActiveFamily(family: { status?: "active" | "archived" }): boolean {
  return family.status !== "archived";
}

async function setStatus(ctx: MutationCtx, instanceId: string, familyId: Id<"creativeFamilies">, status: "active" | "archived") {
  await ownerIdFor(ctx, instanceId);
  const family = await ctx.db.get(familyId);
  // Another Instance's family is "not found", never confirmed to exist.
  if (!family || family.instanceId !== instanceId) throw new Error("Creative Family not found");
  if ((family.status ?? "active") !== status) await ctx.db.patch(familyId, { status });
  return null;
}

const args = { instanceId: v.string(), familyId: v.id("creativeFamilies") };

export const archive = mutation({
  args,
  handler: async (ctx, a) => await setStatus(ctx, a.instanceId, a.familyId, "archived"),
});

export const unarchive = mutation({
  args,
  handler: async (ctx, a) => await setStatus(ctx, a.instanceId, a.familyId, "active"),
});
