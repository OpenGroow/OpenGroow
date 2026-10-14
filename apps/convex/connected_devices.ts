import { internalMutation, query } from "./_generated/server.js";
import { v } from "convex/values";
import { ownerIdFor } from "./instance_ownership.js";

export const listByInstance = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    await ownerIdFor(ctx, args.instanceId);
    return ctx.db
      .query("connectedDevices")
      .withIndex("by_instance_id", (q) => q.eq("instanceId", args.instanceId))
      .order("asc")
      .take(100);
  },
});

export const upsertMany = internalMutation({
  args: {
    instanceId: v.string(),
    connectedAt: v.number(),
    devices: v.array(
      v.object({
        displayName: v.string(),
        caps: v.array(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existingByDisplayName = new Map(
      (
        await ctx.db
          .query("connectedDevices")
          .withIndex("by_instance_id", (q) => q.eq("instanceId", args.instanceId))
          .collect()
      ).map((doc) => [doc.displayName, doc]),
    );

    const seenDisplayNames = new Set<string>();
    for (const device of args.devices) {
      seenDisplayNames.add(device.displayName);
      const existing = existingByDisplayName.get(device.displayName);
      if (existing) {
        await ctx.db.patch(existing._id, {
          connectedAt: args.connectedAt,
          caps: device.caps,
        });
      } else {
        await ctx.db.insert("connectedDevices", {
          instanceId: args.instanceId,
          displayName: device.displayName,
          connectedAt: args.connectedAt,
          caps: device.caps,
        });
      }
    }

    for (const [displayName, doc] of existingByDisplayName) {
      if (!seenDisplayNames.has(displayName)) {
        await ctx.db.delete(doc._id);
      }
    }
  },
});
