import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../_generated/api";
import schema from "../schema";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../connected_devices.ts": () => import("../connected_devices.js"),
};

const INSTANCE_ID = "openclaw-test-instance-1";

describe("connected_devices.upsertMany", () => {
  it("removes stale devices that are no longer reported", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.connected_devices.upsertMany, {
      instanceId: INSTANCE_ID,
      connectedAt: Date.now(),
      devices: [{ displayName: "Phone A", caps: ["camera"] }],
    });

    await t.mutation(internal.connected_devices.upsertMany, {
      instanceId: INSTANCE_ID,
      connectedAt: Date.now(),
      devices: [],
    });

    const remaining = await t.run(async (ctx) =>
      ctx.db
        .query("connectedDevices")
        .withIndex("by_instance_id", (q) => q.eq("instanceId", INSTANCE_ID))
        .collect(),
    );
    expect(remaining).toEqual([]);
  });

  it("keeps devices still present and drops the ones that disappeared", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.connected_devices.upsertMany, {
      instanceId: INSTANCE_ID,
      connectedAt: Date.now(),
      devices: [
        { displayName: "Phone A", caps: ["camera"] },
        { displayName: "Phone B", caps: ["camera"] },
      ],
    });

    await t.mutation(internal.connected_devices.upsertMany, {
      instanceId: INSTANCE_ID,
      connectedAt: Date.now(),
      devices: [{ displayName: "Phone A", caps: ["camera", "mic"] }],
    });

    const remaining = await t.run(async (ctx) =>
      ctx.db
        .query("connectedDevices")
        .withIndex("by_instance_id", (q) => q.eq("instanceId", INSTANCE_ID))
        .collect(),
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.displayName).toBe("Phone A");
    expect(remaining[0]?.caps).toEqual(["camera", "mic"]);
  });
});
