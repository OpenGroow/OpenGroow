import { insertInstance } from "./instance_fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";

// deleteProjectAgent: the Agent and everything of its Template in the Project
// goes, history included; other Templates and the Project's Sources stay.

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../agent_deletion.ts": () => import("../agent_deletion.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../project_agents_node.ts": () => import("../project_agents_node.js"),
  "../runtime_commands_node.ts": () => import("../runtime_commands_node.js"),
  "../instances.ts": () => import("../instances.js"),
  "../commands.ts": () => import("../commands.js"),
  "../events.ts": () => import("../events.js"),
};

const INSTANCE_ID = "openclaw-agent-deletion";
const TEMPLATE_ID = "@acme/seo";
const OTHER_TEMPLATE = "@acme/other";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|del-owner", subject: "owner-del" };
const INTRUDER = { name: "X", email: "x@e.com", tokenIdentifier: "test|del-x", subject: "intruder-del" };

type T = ReturnType<typeof convexTest>;

/** One Template's full footprint: Agent, versions with files, override, Schedule, Job, Missions with Runs, events and Publications. */
async function seedTemplate(t: T, templateId: string, opts: { missions?: number; runsPerMission?: number; runStatus?: "completed" | "pending" | "dispatching" | "running" | "awaiting_job" } = {}) {
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.insert("projectAgents", {
      instanceId: INSTANCE_ID, templateId, status: "inactive", workspaceKey: `ws-${templateId}`, mcpServerKeys: [],
      createdAt: now, updatedAt: now,
    });
    for (const [version, current, staged] of [["1.0.0", true, false], ["1.1.0", false, true]] as const) {
      const installed = await ctx.db.insert("installedTemplates", {
        projectId: INSTANCE_ID, templateId, version, origin: "hub", digest: `sha256:${version}`, manifest: {}, current, staged, installedAt: now,
      });
      await ctx.db.insert("templateFiles", { installedTemplateId: installed, path: "CLAW.md", content: "x" });
      await ctx.db.insert("templateFiles", { installedTemplateId: installed, path: "package.json", content: "{}" });
    }
    await ctx.db.insert("templateMcpUrlOverrides", { projectId: INSTANCE_ID, templateId, serverName: "article-mcp", url: "http://localhost:1/mcp" });
    await ctx.db.insert("schedules", {
      ownerId: OWNER.subject, instanceId: INSTANCE_ID, templateId, type: "create_article", payload: {},
      unit: "daily", hour: 9, minute: 0, timezone: "UTC", status: "active", nextRunAt: now, createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("jobs", {
      ownerId: OWNER.subject, instanceId: INSTANCE_ID, templateId, type: "custom", state: "active", config: {}, runtime: {},
      unit: "daily", hour: 6, minute: 0, timezone: "UTC", nextRunAt: now, createdAt: now, updatedAt: now,
    });
    for (let m = 0; m < (opts.missions ?? 1); m++) {
      const missionId = await ctx.db.insert("missions", {
        ownerId: OWNER.subject, instanceId: INSTANCE_ID, templateId, type: "create_article", payload: {}, status: "done",
        createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("publications", { missionId, instanceId: INSTANCE_ID, target: "instagram:me", status: "pending", createdAt: now, updatedAt: now });
      for (let r = 0; r < (opts.runsPerMission ?? 1); r++) {
        const runId = await ctx.db.insert("runs", {
          missionId, ownerId: OWNER.subject, instanceId: INSTANCE_ID, templateId, agentName: "seo", sessionKey: `s-${m}-${r}`,
          status: opts.runStatus ?? "completed", createdAt: now, updatedAt: now,
        });
        await ctx.db.insert("runReconcileEvents", { runId, missionId, decision: { type: "wait" }, createdAt: now });
      }
    }
  });
}

const TABLES = [
  "projectAgents", "installedTemplates", "templateFiles", "templateMcpUrlOverrides", "schedules", "jobs",
  "missions", "publications", "runs", "runReconcileEvents",
] as const;

async function counts(t: T) {
  return t.run(async (ctx) => {
    const result: Record<string, number> = {};
    for (const table of TABLES) result[table] = (await ctx.db.query(table).collect()).length;
    return result;
  });
}

async function seedInstance(t: T) {
  const iso = new Date().toISOString();
  await t.run((ctx) =>
    insertInstance(ctx, {
      jobId: "job-del", status: "running", runtimeStatus: "linked", runtimeReady: true, createdAt: iso,
      openclawId: INSTANCE_ID, updatedAt: iso, userId: OWNER.subject,
    }),
  );
}

beforeEach(() => {
  vi.stubEnv("ACTIVATION_BROKER_TIMEOUT_MS", "5000");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("deleteProjectAgent", () => {
  it("deletes the inactive Agent and its whole Template footprint, history included, leaving other Templates", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedTemplate(t, TEMPLATE_ID);
    await seedTemplate(t, OTHER_TEMPLATE);
    const before = await counts(t);

    const result = await t.withIdentity(OWNER).action(api.project_agents_node.deleteProjectAgent, { instanceId: INSTANCE_ID, templateId: TEMPLATE_ID });

    expect(result).toEqual({ status: "deleted" });
    const after = await counts(t);
    // Exactly the other Template's footprint is left: half of everything.
    for (const table of TABLES) expect(after[table], table).toBe(before[table]! / 2);
    const left = await t.run((ctx) => ctx.db.query("projectAgents").collect());
    expect(left.map((a) => a.templateId)).toEqual([OTHER_TEMPLATE]);
  });

  it("works through a history larger than one batch", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedTemplate(t, TEMPLATE_ID, { missions: 30, runsPerMission: 3 });

    const result = await t.withIdentity(OWNER).action(api.project_agents_node.deleteProjectAgent, { instanceId: INSTANCE_ID, templateId: TEMPLATE_ID });

    expect(result).toEqual({ status: "deleted" });
    expect(Object.values(await counts(t)).every((n) => n === 0)).toBe(true);
  });

  it.each(["pending", "dispatching", "running", "awaiting_job"] as const)("refuses while a Run is %s, deleting nothing", async (runStatus) => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedTemplate(t, TEMPLATE_ID, { runStatus });
    const before = await counts(t);

    const result = await t.withIdentity(OWNER).action(api.project_agents_node.deleteProjectAgent, { instanceId: INSTANCE_ID, templateId: TEMPLATE_ID });

    expect(result).toEqual({ status: "error", errorMessage: expect.stringMatching(/in flight/) });
    expect(await counts(t)).toEqual(before);
  });

  it("refuses someone who does not own the Project", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedTemplate(t, TEMPLATE_ID);
    const before = await counts(t);

    const result = await t.withIdentity(INTRUDER).action(api.project_agents_node.deleteProjectAgent, { instanceId: INSTANCE_ID, templateId: TEMPLATE_ID });

    expect(result.status).toBe("error");
    expect(await counts(t)).toEqual(before);
  });

  it("purgeBatch reports progress until nothing is left", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedTemplate(t, TEMPLATE_ID, { missions: 40 });
    const first = await t.mutation(internal.agent_deletion.purgeBatch, { instanceId: INSTANCE_ID, templateId: TEMPLATE_ID });
    expect(first).toEqual({ done: false });
    let done = false;
    for (let i = 0; i < 20 && !done; i++) {
      ({ done } = await t.mutation(internal.agent_deletion.purgeBatch, { instanceId: INSTANCE_ID, templateId: TEMPLATE_ID }));
    }
    expect(done).toBe(true);
  });
});
