import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import migrationsComponent from "@convex-dev/migrations/test";
import { runToCompletion } from "@convex-dev/migrations";
import { components, internal } from "../_generated/api";
import schema from "../schema";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../migrations.ts": () => import("../migrations.js"),
};

// Proves issue #267's acceptance criteria: a migration a developer bundles
// into the image runs correctly against existing data on the next
// `docker compose up`. `migrations.ts:exampleMigrationForTests` is never
// added to PENDING_MIGRATIONS — it exists only so this test can drive the
// exact mechanism (runToCompletion against a real @convex-dev/migrations
// component) that apps/convex/docker/bootstrap/entrypoint.sh relies on.
describe("developer-authored migration path", () => {
  it("applies a bundled migration to existing rows to completion", async () => {
    const t = convexTest(schema, modules);
    migrationsComponent.register(t);

    const missionId = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("missions", {
        ownerId: "owner-migrations-test",
        instanceId: "instance-migrations-test",
        templateId: "video-demo",
        type: "create_video",
        payload: {},
        status: "doing",
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.run(async (ctx) => {
      await runToCompletion(
        ctx,
        components.migrations,
        internal.migrations.exampleMigrationForTests,
      );
    });

    const mission = await t.run(async (ctx) => ctx.db.get(missionId));
    expect(mission?.name).toBe("untitled");
  });
});

describe("template id rename migrations", () => {
  it("rewrites the retired video and moneyprinterturbo-agent ids in every table, keeps gateway agent names, and leaves other rows alone", async () => {
    const t = convexTest(schema, modules);
    migrationsComponent.register(t);
    const now = Date.now();

    const ids = await t.run(async (ctx) => {
      const base = { instanceId: "instance", createdAt: now, updatedAt: now };
      const oldAgent = await ctx.db.insert("projectAgents", {
        ...base, templateId: "video", status: "active", openclawAgentName: "video", mcpServerKeys: [],
      });
      const mpt = await ctx.db.insert("projectAgents", {
        ...base, templateId: "moneyprinterturbo-agent", status: "active", openclawAgentName: "moneyprinterturbo-agent", mcpServerKeys: [],
      });
      const seo = await ctx.db.insert("projectAgents", {
        ...base, templateId: "seo", status: "active", openclawAgentName: "seo", mcpServerKeys: [],
      });
      const mission = await ctx.db.insert("missions", {
        ...base, ownerId: "owner", templateId: "video", type: "create_video", payload: {}, status: "doing",
      });
      const seoMission = await ctx.db.insert("missions", {
        ...base, ownerId: "owner", templateId: "seo", type: "audit", payload: {}, status: "doing",
      });
      const schedule = await ctx.db.insert("schedules", {
        ...base, ownerId: "owner", templateId: "moneyprinterturbo-agent", type: "create_reel", payload: {},
        unit: "daily", hour: 9, minute: 0, timezone: "UTC", status: "active", nextRunAt: now,
      });
      const job = await ctx.db.insert("jobs", {
        ...base, ownerId: "owner", templateId: "video", type: "custom", state: "active", config: {}, runtime: {},
        unit: "daily", hour: 9, minute: 0, timezone: "UTC", nextRunAt: now,
      });
      const source = await ctx.db.insert("sources", {
        instanceId: "instance", ownerId: "owner", templateId: "video", sourceId: "fixture", label: "Fixture",
        family: "fixture", status: "ready", origin: "https://example.com", capturedAt: now, createdAt: now,
        marketing: { summary: "A useful marketing angle" }, analysis: {},
      });
      const run = await ctx.db.insert("runs", {
        missionId: mission, ownerId: "owner", instanceId: "instance", templateId: "video",
        agentName: "video", sessionKey: "", status: "completed", createdAt: now, updatedAt: now,
      });
      return { oldAgent, mpt, seo, mission, seoMission, schedule, job, source, run };
    });

    await t.run(async (ctx) => {
      for (const migration of [
        internal.migrations.renameTemplateIdsInProjectAgents,
        internal.migrations.renameTemplateIdsInMissions,
        internal.migrations.renameTemplateIdsInSchedules,
        internal.migrations.renameTemplateIdsInJobs,
        internal.migrations.renameTemplateIdsInSources,
        internal.migrations.renameTemplateIdsInRuns,
      ]) {
        await runToCompletion(ctx, components.migrations, migration);
      }
    });

    const rows = await t.run(async (ctx) => ({
      oldAgent: await ctx.db.get(ids.oldAgent),
      mpt: await ctx.db.get(ids.mpt),
      seo: await ctx.db.get(ids.seo),
      mission: await ctx.db.get(ids.mission),
      seoMission: await ctx.db.get(ids.seoMission),
      schedule: await ctx.db.get(ids.schedule),
      job: await ctx.db.get(ids.job),
      source: await ctx.db.get(ids.source),
      run: await ctx.db.get(ids.run),
    }));
    // The gateway keeps the old agent name until the Agent is re-activated.
    expect(rows.oldAgent).toMatchObject({ templateId: "video-demo", openclawAgentName: "video" });
    expect(rows.mpt).toMatchObject({ templateId: "moneyprinterturbo", openclawAgentName: "moneyprinterturbo-agent" });
    expect(rows.seo).toMatchObject({ templateId: "seo", openclawAgentName: "seo" });
    expect(rows.mission?.templateId).toBe("video-demo");
    expect(rows.seoMission?.templateId).toBe("seo");
    expect(rows.schedule?.templateId).toBe("moneyprinterturbo");
    expect(rows.job?.templateId).toBe("video-demo");
    expect(rows.source?.templateId).toBe("video-demo");
    expect(rows.run).toMatchObject({ templateId: "video-demo", agentName: "video" });
  });
});

describe("carousel template id rename migrations", () => {
  it("rewrites carousel-mcp to visual-social in every table, keeps gateway agent names, and leaves other rows alone", async () => {
    const t = convexTest(schema, modules);
    migrationsComponent.register(t);
    const now = Date.now();

    const ids = await t.run(async (ctx) => {
      const base = { instanceId: "instance", createdAt: now, updatedAt: now };
      const carousel = await ctx.db.insert("projectAgents", {
        ...base, templateId: "carousel-mcp", status: "active", openclawAgentName: "carousel-mcp", mcpServerKeys: ["carousel-mcp"],
      });
      const seo = await ctx.db.insert("projectAgents", {
        ...base, templateId: "seo", status: "active", openclawAgentName: "seo", mcpServerKeys: [],
      });
      const mission = await ctx.db.insert("missions", {
        ...base, ownerId: "owner", templateId: "carousel-mcp", type: "create_carousel", payload: {}, status: "doing",
      });
      const seoMission = await ctx.db.insert("missions", {
        ...base, ownerId: "owner", templateId: "seo", type: "audit", payload: {}, status: "doing",
      });
      const schedule = await ctx.db.insert("schedules", {
        ...base, ownerId: "owner", templateId: "carousel-mcp", type: "create_carousel", payload: {},
        unit: "daily", hour: 9, minute: 0, timezone: "UTC", status: "active", nextRunAt: now,
      });
      const job = await ctx.db.insert("jobs", {
        ...base, ownerId: "owner", templateId: "carousel-mcp", type: "custom", state: "active", config: {}, runtime: {},
        unit: "daily", hour: 9, minute: 0, timezone: "UTC", nextRunAt: now,
      });
      const source = await ctx.db.insert("sources", {
        instanceId: "instance", ownerId: "owner", templateId: "carousel-mcp", sourceId: "fixture", label: "Fixture",
        family: "fixture", status: "ready", origin: "https://example.com", capturedAt: now, createdAt: now,
        marketing: { summary: "A useful marketing angle" }, analysis: {},
      });
      const run = await ctx.db.insert("runs", {
        missionId: mission, ownerId: "owner", instanceId: "instance", templateId: "carousel-mcp",
        agentName: "carousel-mcp", sessionKey: "", status: "completed", createdAt: now, updatedAt: now,
      });
      return { carousel, seo, mission, seoMission, schedule, job, source, run };
    });

    await t.run(async (ctx) => {
      for (const migration of [
        internal.migrations.renameCarouselTemplateIdInProjectAgents,
        internal.migrations.renameCarouselTemplateIdInMissions,
        internal.migrations.renameCarouselTemplateIdInSchedules,
        internal.migrations.renameCarouselTemplateIdInJobs,
        internal.migrations.renameCarouselTemplateIdInSources,
        internal.migrations.renameCarouselTemplateIdInRuns,
      ]) {
        await runToCompletion(ctx, components.migrations, migration);
      }
    });

    const rows = await t.run(async (ctx) => ({
      carousel: await ctx.db.get(ids.carousel),
      seo: await ctx.db.get(ids.seo),
      mission: await ctx.db.get(ids.mission),
      seoMission: await ctx.db.get(ids.seoMission),
      schedule: await ctx.db.get(ids.schedule),
      job: await ctx.db.get(ids.job),
      source: await ctx.db.get(ids.source),
      run: await ctx.db.get(ids.run),
    }));
    // The MCP server key keeps its name, and so does the gateway agent name
    // until the Agent is re-activated: only the Template id changed.
    expect(rows.carousel).toMatchObject({ templateId: "visual-social", openclawAgentName: "carousel-mcp", mcpServerKeys: ["carousel-mcp"] });
    expect(rows.seo).toMatchObject({ templateId: "seo", openclawAgentName: "seo" });
    expect(rows.mission?.templateId).toBe("visual-social");
    expect(rows.seoMission?.templateId).toBe("seo");
    expect(rows.schedule?.templateId).toBe("visual-social");
    expect(rows.job?.templateId).toBe("visual-social");
    expect(rows.source?.templateId).toBe("visual-social");
    expect(rows.run).toMatchObject({ templateId: "visual-social", agentName: "carousel-mcp" });
  });
});
