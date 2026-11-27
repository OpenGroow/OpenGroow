import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { insertInstance } from "./instance_fixture";
import { installTemplateRegistry, loadFixtureTemplate } from "./helpers/template_registry.helpers";

// Issue #174: the content_planning Job type, its configuration and Run Now without a usable target (ADR-086).

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../instances.ts": () => import("../instances.js"),
  "../jobs.ts": () => import("../jobs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../runs.ts": () => import("../runs.js"),
  "../content_planning_jobs.ts": () => import("../content_planning_jobs.js"),
  "../source_jobs.ts": () => import("../source_jobs.js"),
  "../score_jobs.ts": () => import("../score_jobs.js"),
};

const INSTANCE = "instance-cp-job";
const TEMPLATE = "strategy-capable";
const PRODUCER = "producer-capable";
const OWNER = { name: "Owner", email: "owner@example.com", tokenIdentifier: "test|owner-cp", subject: "owner-cp" };
const OTHER = { name: "Other", email: "other@example.com", tokenIdentifier: "test|other-cp", subject: "other-cp" };
// A Monday, 2030-03-04 10:00 UTC.
const NOW = Date.UTC(2030, 2, 4, 10, 0, 0);
const DAY = 86_400_000;

const mission = (type: string, publish?: { kind: string }) => ({ type, label: type, agentsMd: `${type}.md`, ...(publish ? { publish } : {}) });
const producer = () => {
  const base = loadFixtureTemplate(TEMPLATE);
  return {
    ...base,
    manifest: {
      ...base.manifest,
      id: PRODUCER,
      jobTypes: [],
      missionTypes: [mission("make_video", { kind: "video" }), mission("make_post", { kind: "image" }), mission("research")],
    },
  } as unknown as ReturnType<typeof loadFixtureTemplate>;
};

type T = ReturnType<typeof convexTest>;
let t: T;
let restoreRegistry: () => void;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  restoreRegistry = installTemplateRegistry([INSTANCE], [loadFixtureTemplate(TEMPLATE), producer()]);
  t = convexTest(schema, modules);
  await t.run((ctx) =>
    insertInstance(ctx, {
      jobId: "provisioning", status: "running", runtimeStatus: "linked", runtimeReady: true,
      createdAt: new Date(NOW).toISOString(), openclawId: INSTANCE, updatedAt: new Date(NOW).toISOString(), userId: OWNER.subject,
    }),
  );
  await activate(TEMPLATE);
});
afterEach(() => {
  vi.useRealTimers();
  restoreRegistry();
});

const activate = (templateId: string, status: "active" | "inactive" = "active") =>
  t.mutation(internal.project_agents.upsert, { instanceId: INSTANCE, templateId, status, workspaceKey: `ws-${templateId}`, openclawAgentName: templateId });

const addPublisher = (targets: string[]) =>
  t.run((ctx) => ctx.db.insert("publishers", { instanceId: INSTANCE, adapter: "example", url: "https://publisher.example.com", targets: targets.map((target) => ({ target })), updatedAt: NOW }));

const planningJob = async () => {
  const jobs = await t.run((ctx) => ctx.db.query("jobs").collect());
  return jobs.find((job) => job.type === "content_planning")!;
};
const reload = (jobId: Id<"jobs">) => t.run((ctx) => ctx.db.get(jobId));
const owner = () => t.withIdentity(OWNER);
const video = (overrides: Record<string, unknown> = {}) => ({ contentType: "video", quantity: 3, publishTargets: ["social:example"], ...overrides });

describe("provisioning", () => {
  it("creates the Job active, weekly on Monday 06:00 UTC, 7 days, no target", async () => {
    const job = await planningJob();
    expect(job).toMatchObject({
      state: "active", unit: "weekly", dayOfWeek: 1, hour: 6, minute: 0, timezone: "UTC",
      config: { planningDays: 7, productionTargets: [] },
    });
    expect(job.nextRunAt).toBeGreaterThan(NOW + 6 * DAY);
  });

  it("is idempotent when the Agent is activated again, and keeps the saved configuration", async () => {
    await addPublisher(["social:example"]);
    await activate(PRODUCER);
    const first = await planningJob();
    await owner().mutation(api.content_planning_jobs.setConfig, { jobId: first._id, planningDays: 14, productionTargets: [video()] });
    await activate(TEMPLATE, "inactive");
    await activate(TEMPLATE);
    const jobs = (await t.run((ctx) => ctx.db.query("jobs").collect())).filter((job) => job.type === "content_planning");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.config).toMatchObject({ planningDays: 14 });
  });

  it("is not provisioned for an Agent that does not declare it", async () => {
    await activate(PRODUCER);
    const jobs = await t.run((ctx) => ctx.db.query("jobs").collect());
    expect(jobs.filter((job) => job.templateId === PRODUCER)).toEqual([]);
  });
});

describe("options", () => {
  it("offers the formats of active Agents' publishing Mission types, and the Publish targets", async () => {
    await activate(PRODUCER);
    await addPublisher(["social:example", "blog:example"]);
    expect(await owner().query(api.content_planning_jobs.options, { instanceId: INSTANCE })).toEqual({
      formats: ["image", "video"],
      publishTargets: ["social:example", "blog:example"],
    });
  });

  it("offers no format from an inactive Agent or a Mission type without publish", async () => {
    expect((await owner().query(api.content_planning_jobs.options, { instanceId: INSTANCE })).formats).toEqual([]);
    await activate(PRODUCER);
    await activate(PRODUCER, "inactive");
    expect((await owner().query(api.content_planning_jobs.options, { instanceId: INSTANCE })).formats).toEqual([]);
  });
});

describe("setConfig", () => {
  beforeEach(async () => {
    await activate(PRODUCER);
    await addPublisher(["social:example", "blog:example"]);
  });
  const save = async (overrides: { planningDays?: number; productionTargets?: unknown[] } = {}, as = owner()) => {
    const job = await planningJob();
    return as.mutation(api.content_planning_jobs.setConfig, {
      jobId: job._id, planningDays: 7, productionTargets: [video()], ...overrides,
    } as never);
  };

  it("stores a valid configuration without touching the recurrence", async () => {
    const before = await planningJob();
    await save({ planningDays: 30, productionTargets: [video(), video({ contentType: "image", quantity: 2, publishTargets: ["blog:example"] })] });
    const after = await planningJob();
    expect(after.config).toEqual({ planningDays: 30, productionTargets: [video(), video({ contentType: "image", quantity: 2, publishTargets: ["blog:example"] })] });
    expect([after.unit, after.dayOfWeek, after.hour, after.nextRunAt]).toEqual([before.unit, before.dayOfWeek, before.hour, before.nextRunAt]);
  });

  it.each([0, 61])("refuses a horizon of %j", async (planningDays) => {
    await expect(save({ planningDays })).rejects.toThrow(/planning horizon/);
  });
  it("refuses an unknown format and an unknown Publish target", async () => {
    await expect(save({ productionTargets: [video({ contentType: "podcast" })] })).rejects.toThrow(/Unknown format/);
    await expect(save({ productionTargets: [video({ publishTargets: ["nowhere:x"] })] })).rejects.toThrow(/Unknown Publish target/);
  });
  it("refuses a total quantity above 100", async () => {
    await expect(save({ productionTargets: [video({ quantity: 80 }), video({ contentType: "image", quantity: 21 })] })).rejects.toThrow(/100/);
  });
  it("refuses a user who does not own the Project and leaves the configuration unchanged", async () => {
    await expect(save({}, t.withIdentity(OTHER))).rejects.toThrow(/Forbidden/);
    expect((await planningJob()).config).toEqual({ planningDays: 7, productionTargets: [] });
  });
});

describe("Run Now", () => {
  const runNowAndTick = async () => {
    const job = await planningJob();
    await owner().mutation(api.jobs.runNow, { jobId: job._id });
    await t.mutation(internal.content_planning_jobs.tick, {});
    return (await reload(job._id))!;
  };
  const runCount = async () => (await t.run((ctx) => ctx.db.query("runs").collect())).length;

  it("with no target ends skipped with a readable summary, creates no Run and consumes the request", async () => {
    const job = await runNowAndTick();
    expect(job).toMatchObject({ lastOutcome: "skipped", lastSummary: "no production targets configured", state: "active" });
    expect(job.runNowAt).toBeUndefined();
    expect(job.nextRunAt).toBeGreaterThan(NOW + 6 * DAY);
    expect(await runCount()).toBe(0);
  });

  it("ignores a target whose format disappeared, reports it, and leaves the stored configuration alone", async () => {
    await activate(PRODUCER);
    await addPublisher(["social:example"]);
    const before = await planningJob();
    await owner().mutation(api.content_planning_jobs.setConfig, { jobId: before._id, planningDays: 7, productionTargets: [video()] });
    await activate(PRODUCER, "inactive");
    const job = await runNowAndTick();
    expect(job.lastOutcome).toBe("skipped");
    expect(job.lastSummary).toContain("no production targets configured");
    expect(job.lastSummary).toContain("video");
    expect(job.config).toMatchObject({ productionTargets: [video()] });
    expect(await runCount()).toBe(0);
  });

  it.each([
    ["a horizon outside 1 to 60", { planningDays: 90, productionTargets: [video()] }, /planning horizon/],
    ["a total quantity above 100", { planningDays: 7, productionTargets: [video({ quantity: 80 }), video({ contentType: "image", quantity: 21, publishTargets: ["social:example"] })] }, /100/],
    ["a format listed twice", { planningDays: 7, productionTargets: [video(), video({ quantity: 1 })] }, /listed twice/],
  ])("ends failed with a clear message for a stored configuration with %s, and creates no Run", async (_name, config, message) => {
    await activate(PRODUCER);
    await addPublisher(["social:example"]);
    const before = await planningJob();
    await t.run((ctx) => ctx.db.patch(before._id, { config }));
    const job = await runNowAndTick();
    expect(job.lastOutcome).toBe("failed");
    expect(job.lastError).toMatch(/stored configuration is invalid/);
    expect(job.lastError).toMatch(message);
    expect(job.runNowAt).toBeUndefined();
    expect(await runCount()).toBe(0);
  });

  it("a paused Job runs on request and goes back to paused", async () => {
    const before = await planningJob();
    await owner().mutation(api.jobs.pause, { jobId: before._id });
    const job = await runNowAndTick();
    expect(job).toMatchObject({ state: "paused", lastOutcome: "skipped" });
  });
});
