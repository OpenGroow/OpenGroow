import { insertInstance } from "./instance_fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../_generated/api";
import schema from "../schema";

import { installTemplateRegistry, loadFixtureTemplate } from "./helpers/template_registry.helpers";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../instances.ts": () => import("../instances.js"),
  "../jobs.ts": () => import("../jobs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../source_jobs.ts": () => import("../source_jobs.js"),
  "../score_jobs.ts": () => import("../score_jobs.js"),
};

const INSTANCE = "instance-review-recurrence";
const TEMPLATE = "strategy-capable";
// A Monday, 2030-03-04 10:00 UTC.
const NOW = Date.UTC(2030, 2, 4, 10, 0, 0);

let restoreRegistry: () => void;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  restoreRegistry = installTemplateRegistry([INSTANCE], [loadFixtureTemplate(TEMPLATE)]);
});

afterEach(() => {
  vi.useRealTimers();
  restoreRegistry();
});

describe("strategic_review default recurrence", () => {
  it("is provisioned weekly (every 7 days), not daily", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      insertInstance(ctx, {
        jobId: "provisioning-job", status: "running", runtimeStatus: "linked", runtimeReady: true,
        createdAt: new Date(NOW).toISOString(), openclawId: INSTANCE, updatedAt: new Date(NOW).toISOString(), userId: "owner",
      }),
    );
    await t.mutation(internal.project_agents.upsert, {
      instanceId: INSTANCE, templateId: TEMPLATE, status: "active", workspaceKey: "workspace-review", openclawAgentName: TEMPLATE,
    });

    const jobs = await t.run(async (ctx) => await ctx.db.query("jobs").collect());
    expect(jobs.map((job) => job.type).sort()).toEqual(["content_planning", "strategic_review"]);
    jobs.splice(0, jobs.length, ...jobs.filter((job) => job.type === "strategic_review"));
    expect(jobs[0]).toMatchObject({ type: "strategic_review", unit: "weekly", dayOfWeek: 1, hour: 6, minute: 0, config: { analysisDays: 30 } });
    expect(jobs[0]!.nextRunAt).toBeGreaterThan(NOW + 6 * 86_400_000);
    expect(jobs[0]!.nextRunAt).toBeLessThanOrEqual(NOW + 7 * 86_400_000);
  });
});
