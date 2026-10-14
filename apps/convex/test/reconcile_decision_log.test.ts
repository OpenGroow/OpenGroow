import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
};

describe("run reconciliation decision log", () => {
  it("keeps legacy blocked_external decisions readable after the RunResult contract changes", async () => {
    const t = convexTest(schema, modules);

    const eventId = await t.run(async (ctx) => {
      const now = Date.now();
      const missionId = await ctx.db.insert("missions", {
        ownerId: "legacy-owner",
        instanceId: "legacy-instance",
        templateId: "@opengroow/seo",
        type: "create_article",
        payload: {},
        status: "blocked",
        createdAt: now,
        updatedAt: now,
      });
      const runId = await ctx.db.insert("runs", {
        missionId,
        ownerId: "legacy-owner",
        instanceId: "legacy-instance",
        templateId: "@opengroow/seo",
        agentName: "seo",
        sessionKey: "legacy-session",
        status: "failed",
        createdAt: now,
        updatedAt: now,
      });

      return await ctx.db.insert("runReconcileEvents", {
        runId,
        missionId,
        decision: {
          type: "markCompleted",
          result: {
            status: "blocked_external",
            summary: "Waiting for the first keyword batch to be validated.",
            message: "Open the MCP dashboard and validate the batch.",
            dashboardUrl: "http://localhost:4010/dashboard/projects/example/keywords",
          },
        },
        createdAt: now,
      });
    });

    const event = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(event?.decision).toMatchObject({
      type: "markCompleted",
      result: { status: "blocked_external" },
    });
  });
});
