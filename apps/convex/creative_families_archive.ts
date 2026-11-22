import { v } from "convex/values";
import type { Id } from "./_generated/dataModel.js";
import { mutation, type MutationCtx } from "./_generated/server.js";
import { isActiveFamily, requireOwnedFamily } from "./creative_families.js";
import { ownerIdFor } from "./instance_ownership.js";

// Archive and unarchive a Creative Family (ADR-082). An archived family is no
// longer offered as a destination (see `isActiveFamily`), but its Sources keep
// their link to it and stay listed under it. Nothing else about it changes.

async function setStatus(ctx: MutationCtx, instanceId: string, familyId: Id<"creativeFamilies">, status: "active" | "archived") {
  await ownerIdFor(ctx, instanceId);
  const family = await requireOwnedFamily(ctx, instanceId, familyId);
  if (isActiveFamily(family) !== (status === "active")) {
    // A family that is active again was not merged away any more.
    await ctx.db.patch(familyId, status === "active" ? { status, mergedIntoId: undefined } : { status });
  }
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
