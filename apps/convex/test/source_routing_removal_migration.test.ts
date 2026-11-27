import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import migrationsComponent from "@convex-dev/migrations/test";
import { runToCompletion } from "@convex-dev/migrations";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { insertInstance } from "./instance_fixture";
import { fixtureTemplate, installTemplateRegistry } from "./helpers/template_registry.helpers";

// ADR-089: Source routing is removed; what it left on Sources and the Jobs it ran as go with it.

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../migrations.ts": () => import("../migrations.js"),
};

const syncModules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../instances.ts": () => import("../instances.js"),
  "../jobs.ts": () => import("../jobs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
};

const INSTANCE = "instance-mig";
const SYNC_INSTANCE = "instance-sync";
const OWNER = "owner-mig";
const NOW = Date.UTC(2030, 2, 4, 10, 0, 0);

async function migrate(t: ReturnType<typeof convexTest>, migration: Parameters<typeof runToCompletion>[2]) {
  await t.run(async (ctx) => {
    await runToCompletion(ctx, components.migrations, migration);
  });
}

describe("migrations.dropSourceProduction", () => {
  it("clears the day's pick, the routing decision and the production pointers of a Source, and nothing else", async () => {
    const t = convexTest(schema, modules);
    migrationsComponent.register(t);
    const { sourceId, kept } = await t.run(async (ctx) => {
      const missionId = await ctx.db.insert("missions", { ownerId: OWNER, instanceId: INSTANCE, templateId: "tpl", type: "make_post", payload: {}, status: "done", createdAt: NOW, updatedAt: NOW });
      const base = {
        instanceId: INSTANCE, ownerId: OWNER, templateId: "example/source", sourceId: "post", label: "Example source", family: "fam", status: "ready" as const,
        marketing: { summary: "about" }, analysis: {}, origin: "https://example.com/p", capturedAt: NOW, createdAt: NOW,
      };
      const sourceId = await ctx.db.insert("sources", {
        ...base, scoring: { replicationScore: 80 }, selectedAt: NOW, producedAt: NOW, publishedAt: NOW, productionMissionId: missionId,
        routing: { state: "proposed" }, routeTo: { templateId: "tpl", missionType: "make_post" },
      } as never);
      const kept = await ctx.db.insert("sources", { ...base, label: "Untouched" });
      return { sourceId, kept };
    });

    await migrate(t, internal.migrations.dropSourceProduction);
    await migrate(t, internal.migrations.dropSourceProduction);

    await t.run(async (ctx) => {
      const source = (await ctx.db.get(sourceId))!;
      for (const field of ["selectedAt", "producedAt", "publishedAt", "productionMissionId", "routing", "routeTo"]) expect(source).not.toHaveProperty(field);
      expect(source).toMatchObject({ label: "Example source", scoring: { replicationScore: 80 }, status: "ready" });
      expect((await ctx.db.get(kept))!.label).toBe("Untouched");
      expect((await ctx.db.query("missions").collect())).toHaveLength(1);
    });
  });
});

describe("migrations.deleteSourceRoutingJobs", () => {
  it("deletes source_routing Jobs with their Runs and events, and leaves the other Jobs and their Runs", async () => {
    const t = convexTest(schema, modules);
    migrationsComponent.register(t);
    const ids = await t.run(async (ctx) => {
      const job = (type: string) =>
        ctx.db.insert("jobs", {
          ownerId: OWNER, instanceId: INSTANCE, templateId: "tpl", type, state: "active", config: {}, runtime: {},
          unit: "daily", hour: 6, minute: 0, timezone: "UTC", nextRunAt: NOW, createdAt: NOW, updatedAt: NOW,
        } as never);
      const run = (jobId: Id<"jobs">) =>
        ctx.db.insert("runs", { jobId, ownerId: OWNER, instanceId: INSTANCE, templateId: "tpl", agentName: "a", sessionKey: "s", status: "completed", createdAt: NOW, updatedAt: NOW } as never);
      const routing = await job("source_routing");
      const scoring = await job("source_scoring");
      const routingRun = await run(routing);
      const scoringRun = await run(scoring);
      await ctx.db.insert("runReconcileEvents", { runId: routingRun, decision: { type: "wait" }, createdAt: NOW });
      return { routing, scoring, routingRun, scoringRun };
    });

    await migrate(t, internal.migrations.deleteSourceRoutingJobs);

    await t.run(async (ctx) => {
      expect(await ctx.db.get(ids.routing)).toBeNull();
      expect(await ctx.db.get(ids.routingRun)).toBeNull();
      expect(await ctx.db.query("runReconcileEvents").collect()).toEqual([]);
      expect(await ctx.db.get(ids.scoring)).not.toBeNull();
      expect(await ctx.db.get(ids.scoringRun)).not.toBeNull();
    });
  });
});

describe("Job sync after the routing removal", () => {
  it("creates no Job for a Job type with no runner, even when an installed Template version still declares it", async () => {
    const restore = installTemplateRegistry([SYNC_INSTANCE], [
      fixtureTemplate("example/source", { jobTypes: [{ type: "source_scoring", agentsMd: "jobs/source-scoring.md" }, { type: "source_routing", agentsMd: "jobs/source-routing.md" }] } as never),
    ]);
    try {
      const t = convexTest(schema, syncModules);
      await t.run((ctx) =>
        insertInstance(ctx, {
          jobId: "provisioning", status: "running", runtimeStatus: "linked", runtimeReady: true,
          createdAt: new Date(NOW).toISOString(), openclawId: SYNC_INSTANCE, updatedAt: new Date(NOW).toISOString(), userId: OWNER,
        }),
      );
      const activate = () => t.mutation(internal.project_agents.upsert, { instanceId: SYNC_INSTANCE, templateId: "example/source", status: "active", workspaceKey: "ws", openclawAgentName: "source" });
      await activate();
      await activate();
      const types = (await t.run((ctx) => ctx.db.query("jobs").collect())).map((job) => job.type);
      expect(types).toEqual(["source_scoring"]);
    } finally {
      restore();
    }
  });
});
