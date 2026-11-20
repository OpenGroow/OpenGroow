import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { assertMissionCreatable } from "../mission_validation";

const modules = { "../_generated/api.ts": () => import("../_generated/api.js") };
const INSTANCE_ID = "openclaw-instance-validation-1";
const TEMPLATE_ID = "@example/agent";

async function seedAgent(
  t: ReturnType<typeof convexTest>,
  overrides: { status?: "active" | "inactive"; openclawAgentName?: string } = {},
) {
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("projectAgents", {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      status: overrides.status ?? "active",
      workspaceKey: "ws-test",
      ...("openclawAgentName" in overrides ? { openclawAgentName: overrides.openclawAgentName } : { openclawAgentName: "agent" }),
      mcpServerKeys: [],
      createdAt: now,
      updatedAt: now,
    });
  });
}

const check = (t: ReturnType<typeof convexTest>, payload: unknown = {}) =>
  t.run((ctx) =>
    assertMissionCreatable(ctx, { instanceId: INSTANCE_ID, templateId: TEMPLATE_ID, type: "create_article", payload }),
  );

describe("assertMissionCreatable", () => {
  it("accepts a candidate Mission without creating anything", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t);
    await check(t);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("missions").collect()).toHaveLength(0);
      expect(await ctx.db.query("runs").collect()).toHaveLength(0);
      expect(await ctx.db.query("projectCounters").collect()).toHaveLength(0);
    });
  });

  it("refuses when the agent of the Mission type is missing or not active", async () => {
    const t = convexTest(schema, modules);
    await expect(check(t)).rejects.toThrow(/not active/);
    await seedAgent(t, { status: "inactive" });
    await expect(check(t)).rejects.toThrow(/not active/);
  });

  it("refuses an agent without an openclawAgentName", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t, { openclawAgentName: undefined });
    await expect(check(t)).rejects.toThrow(/openclawAgentName/);
  });

  it("refuses a channel the Project does not have", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t);
    await expect(check(t, { publishTargets: ["nowhere"] })).rejects.toThrow(/nowhere/);
  });
});
