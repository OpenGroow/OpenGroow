import { insertInstance } from "./instance_fixture";
import { beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { generateAgentToken } from "../internal_mcp/agent_token";
import { installPostiz } from "./postiz_fixture";
import { installAnalyticsAdapter, POSTIZ_ANALYTICS, WEB_ANALYTICS } from "./analytics_fixture";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";
import { recipeCatalog } from "../recipe_usage";
import type { Id } from "../_generated/dataModel";

// Issue #158: the Internal MCP's recipe catalog with its usage history.

process.env.DASHBOARD_URL = "http://localhost:3001";
process.env.BETTER_AUTH_SECRET = "test-better-auth-secret";
process.env.BROKER_URL = "http://localhost:4000";
process.env.BROKER_KEY_ID = "test-broker-key";
process.env.BROKER_SECRET = "test-broker-secret";
process.env.OPENCLAW_CONTROL_URL = "http://localhost:4001";
process.env.OPENCLAW_CONTROL_KEY_ID = "test-control-key";
process.env.OPENCLAW_CONTROL_SECRET = "test-control-secret";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../http.ts": () => import("../http.js"),
  "../internal_mcp/server.ts": () => import("../internal_mcp/server.js"),
  "../internal_mcp/http.ts": () => import("../internal_mcp/http.js"),
  "../publishers.ts": () => import("../publishers.js"),
  "../instances.ts": () => import("../instances.js"),
};

const PROJECT_A = "project-a";
const PROJECT_B = "project-b";
const STRATEGIST = "example/strategist";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|owner", subject: "owner" };
const DAY = 24 * 3_600_000;
const internalServer = (tools: string[]) => ({ name: "opengroow", transport: "streamable-http", url: "", internal: { tools } });

useTemplateRegistry([PROJECT_A, PROJECT_B, "project-idle"], [fixtureTemplate(STRATEGIST, { mcpServers: [internalServer(["list_production_recipes"])] })]);

let t: ReturnType<typeof convexTest>;
beforeEach(() => {
  t = convexTest(schema, modules);
});

async function seedProject(projectId: string, withRun = true) {
  const token = generateAgentToken(projectId, STRATEGIST);
  await t.run(async (ctx) => {
    const now = Date.now();
    await insertInstance(ctx, { jobId: `job-${projectId}`, status: "running", runtimeStatus: "linked", runtimeReady: true, createdAt: new Date().toISOString(), openclawId: projectId, updatedAt: new Date().toISOString(), userId: OWNER.tokenIdentifier });
    await ctx.db.insert("projectAgents", { instanceId: projectId, templateId: STRATEGIST, status: "active", mcpServerKeys: ["opengroow"], config: { apiKey: token }, createdAt: now, updatedAt: now });
    if (withRun) {
      const missionId = await ctx.db.insert("missions", { ownerId: "owner", instanceId: projectId, templateId: STRATEGIST, type: "report", payload: {}, status: "doing", createdAt: now, updatedAt: now });
      await ctx.db.insert("runs", { missionId, ownerId: "owner", instanceId: projectId, templateId: STRATEGIST, agentName: "a", sessionKey: `s-${projectId}`, status: "running", createdAt: now, updatedAt: now });
    }
  });
  return token;
}

async function call(token: string, name: string, args: unknown = {}) {
  const response = await t.fetch("/internal-mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  return response.json();
}
async function recipes(token: string, args: unknown = {}) {
  return JSON.parse((await call(token, "list_production_recipes", args)).result.content[0].text);
}
type Entry = { name: string; neverUsedEver?: boolean; neverPublishedEver?: boolean; usage: { lifetime: Record<string, number>; period: Record<string, number>; lastMissionAt?: number; lastAttemptAt?: number; lastPublicationAt?: number } };
const entry = (answer: { recipes: Entry[] }, name: string) => answer.recipes.find((r) => r.name === name)!;

async function recipe(projectId: string, name: string) {
  return t.run((ctx) => ctx.db.insert("productionRecipes", { instanceId: projectId, templateId: STRATEGIST, missionType: "make_image", name, description: "d" }));
}
async function mission(projectId: string, recipeId: Id<"productionRecipes"> | undefined, o: { status?: string; ageDays?: number } = {}) {
  return t.run((ctx) => {
    const createdAt = Date.now() - (o.ageDays ?? 1) * DAY;
    return ctx.db.insert("missions", {
      ownerId: "owner", instanceId: projectId, templateId: STRATEGIST, type: "make_image", payload: {}, status: o.status ?? "done", createdAt, updatedAt: createdAt,
      lastArtifact: { publishable: { kind: "image", imageUrl: "https://cdn.example.com/i.jpg", caption: "c" } },
      ...(recipeId ? { recipeSnapshot: { recipeId, recipeName: "R", version: 1, instructions: "i", constraints: [] } } : {}),
    } as never);
  });
}
async function run(projectId: string, missionId: Id<"missions">, o: { dispatched: boolean; status?: string; result?: string; ageDays?: number }) {
  await t.run((ctx) => {
    const at = Date.now() - (o.ageDays ?? 1) * DAY;
    return ctx.db.insert("runs", {
      missionId, ownerId: "owner", instanceId: projectId, templateId: STRATEGIST, agentName: "a", sessionKey: `s-${Math.random()}`, status: o.status ?? "completed",
      ...(o.dispatched ? { dispatchedAt: at } : {}), ...(o.result ? { result: { status: o.result, summary: "s", ...(o.result === "needs_human_review" ? { reviewQuestions: [] } : {}), ...(o.result === "failed" ? { error: { code: "x", message: "m" } } : {}) } } : {}), createdAt: at, updatedAt: at,
    } as never);
  });
}
async function publish(projectId: string, missionId: Id<"missions">, o: { ageDays?: number; metrics?: Record<string, number>; externalUrl?: string; adapter?: string } = {}) {
  await t.run(async (ctx) => {
    const now = Date.now();
    const publishedAt = now - (o.ageDays ?? 1) * DAY;
    const publicationId = await ctx.db.insert("publications", { missionId, instanceId: projectId, target: "instagram:me", status: "published", externalId: "p", ...(o.externalUrl ? { externalUrl: o.externalUrl } : {}), createdAt: publishedAt, updatedAt: publishedAt } as never);
    await ctx.db.insert("publicationAnalytics", { publicationId, postSeries: 0, instanceId: projectId, adapter: "postiz-analytics", publisherAdapter: "postiz", publishedAt, delays: [DAY], taken: 0, state: "waiting", nextAt: publishedAt + DAY, done: false, updatedAt: now });
    if (o.metrics) await ctx.db.insert("performanceSnapshots", { publicationId, postSeries: 0, instanceId: projectId, delayMs: DAY, takenAt: now, metrics: o.metrics, adapter: o.adapter ?? "postiz-analytics", source: "adapter" });
  });
}
async function setupPublishing(projectId: string) {
  await installPostiz(t);
  await installAnalyticsAdapter(t, POSTIZ_ANALYTICS);
  const owner = t.withIdentity(OWNER);
  await owner.mutation(api.publishers.save, { instanceId: projectId, adapter: "postiz", url: "https://postiz.example.com", apiKey: "secret" });
  await owner.mutation(api.publishers.addChannel, { adapter: "postiz", instanceId: projectId, channelId: "ch-1", channelName: "My IG", channelService: "instagram", channelProfile: "me" });
}

describe("list_production_recipes period", () => {
  async function seedPeriod() {
    const token = await seedProject(PROJECT_A);
    const r = await recipe(PROJECT_A, "R");
    await mission(PROJECT_A, r, { ageDays: 40 });
    await mission(PROJECT_A, r, { ageDays: 10 });
    await mission(PROJECT_A, r, { ageDays: 2 });
    return token;
  }
  const errorOf = async (token: string, args: unknown) => JSON.stringify((await call(token, "list_production_recipes", args)).result ?? (await call(token, "list_production_recipes", args)).error);

  it("counts the period of an explicit from and to exactly", async () => {
    const token = await seedPeriod();
    const now = Date.now();
    const e = entry(await recipes(token, { from: now - 20 * DAY, to: now - 5 * DAY }), "R");
    expect(e.usage.period).toMatchObject({ missions: 1 });
    expect(e.usage.lifetime).toMatchObject({ missions: 3 });
  });

  it("refuses from/to with days, a missing half, or a span over 365 days, readably", async () => {
    const token = await seedPeriod();
    const now = Date.now();
    for (const args of [{ days: 7, from: now - DAY, to: now }, { from: now - DAY }, { to: now }, { from: now - 400 * DAY, to: now }]) {
      const text = await errorOf(token, args);
      expect(text).toMatch(/days|from|to|365/i);
      expect(text).not.toMatch(/\bstack\b/i);
    }
  });

  it("with days only behaves as before", async () => {
    const token = await seedPeriod();
    expect(entry(await recipes(token, { days: 30 }), "R").usage.period).toMatchObject({ missions: 2 });
    expect(entry(await recipes(token), "R").usage.period).toMatchObject({ missions: 2 });
  });
});

describe("list_production_recipes", () => {
  it("counts a recipe selected only by a cancelled Mission as a Mission, not as a Production Attempt", async () => {
    const token = await seedProject(PROJECT_A);
    const r = await recipe(PROJECT_A, "Cancelled one");
    const cancelled = await mission(PROJECT_A, r, { status: "cancelled" });
    await run(PROJECT_A, cancelled, { dispatched: false, status: "cancelled" });
    const e = entry(await recipes(token), "Cancelled one");
    expect(e).not.toHaveProperty("creativeFamily");
    expect(e.usage.lifetime).toMatchObject({ missions: 1, productionAttempts: 0, successfulAttempts: 0, publications: 0 });
    expect(e.neverUsedEver).toBe(false);
  });

  it("counts dispatched Runs as attempts, and only completed ones with a result as successful", async () => {
    const token = await seedProject(PROJECT_A);
    const r = await recipe(PROJECT_A, "R");
    const m = await mission(PROJECT_A, r);
    await run(PROJECT_A, m, { dispatched: true, result: "success" });
    await run(PROJECT_A, m, { dispatched: true, result: "needs_human_review" });
    await run(PROJECT_A, m, { dispatched: true, status: "failed", result: "failed" });
    await run(PROJECT_A, m, { dispatched: true, status: "resumed" });
    await run(PROJECT_A, m, { dispatched: false, status: "pending" });
    const e = entry(await recipes(token), "R");
    expect(e.usage.lifetime).toMatchObject({ missions: 1, productionAttempts: 4, successfulAttempts: 2 });
    expect(e.usage.lastAttemptAt).toBeGreaterThan(0);
  });

  it("lists a recipe executed but never published with neverPublishedEver true", async () => {
    const token = await seedProject(PROJECT_A);
    const r = await recipe(PROJECT_A, "Unpublished");
    await run(PROJECT_A, await mission(PROJECT_A, r), { dispatched: true, result: "success" });
    const e = entry(await recipes(token), "Unpublished");
    expect(e.neverUsedEver).toBe(false);
    expect(e.neverPublishedEver).toBe(true);
  });

  it("counts Publications and measured ones, over the lifetime and over the period, by their own dates", async () => {
    const token = await seedProject(PROJECT_A);
    await setupPublishing(PROJECT_A);
    const r = await recipe(PROJECT_A, "Published");
    const old = await mission(PROJECT_A, r, { ageDays: 100 });
    const recent = await mission(PROJECT_A, r, { ageDays: 2 });
    await publish(PROJECT_A, old, { ageDays: 90, metrics: { views: 5 } });
    await publish(PROJECT_A, recent, { ageDays: 1 });
    await publish(PROJECT_A, recent, { ageDays: 1, metrics: { views: 9 } });
    const e = entry(await recipes(token, { days: 30 }), "Published");
    expect(e.usage.lifetime).toMatchObject({ missions: 2, publications: 3, measuredPublications: 2 });
    expect(e.usage.period).toMatchObject({ missions: 1, publications: 2, measuredPublications: 1 });
    expect(e.neverPublishedEver).toBe(false);
    expect(e.usage.lastPublicationAt).toBeGreaterThan(0);
  });

  it("counts a page shared by several Publications as measured once, and for no recipe when two recipes share it", async () => {
    const token = await seedProject(PROJECT_A);
    await setupPublishing(PROJECT_A);
    await installAnalyticsAdapter(t, WEB_ANALYTICS);
    await t.withIdentity(OWNER).mutation(api.publishers.setAnalyticsLink, { instanceId: PROJECT_A, adapter: "postiz", target: "instagram:me", analyticsAdapter: "web-analytics" });
    const a = await recipe(PROJECT_A, "A");
    const b = await recipe(PROJECT_A, "B");
    const shared = { externalUrl: "https://example.com/article-1", adapter: "web-analytics", metrics: { views: 10 } };
    await publish(PROJECT_A, await mission(PROJECT_A, a), shared);
    await publish(PROJECT_A, await mission(PROJECT_A, a), { ...shared, externalUrl: "https://example.com/article-1/?utm_source=x" });
    const once = await recipes(token);
    expect(entry(once, "A").usage.lifetime).toMatchObject({ publications: 2, measuredPublications: 1 });
    await publish(PROJECT_A, await mission(PROJECT_A, b), shared);
    const split = await recipes(token);
    expect(entry(split, "A").usage.lifetime).toMatchObject({ publications: 2, measuredPublications: 0 });
    expect(entry(split, "B").usage.lifetime).toMatchObject({ publications: 1, measuredPublications: 0 });
  });

  it("is partial, and asserts no never flag, when a Mission has more Runs than were read", async () => {
    const token = await seedProject(PROJECT_A);
    const r = await recipe(PROJECT_A, "Busy");
    await recipe(PROJECT_A, "Idle");
    const m = await mission(PROJECT_A, r);
    for (let i = 0; i < 100; i += 1) await run(PROJECT_A, m, { dispatched: true, result: "success" });
    const answer = await recipes(token);
    expect(answer.partial).toBe(true);
    expect(entry(answer, "Idle").neverUsedEver).toBeUndefined();
  });

  it("lists a never-used recipe, with no archived flag", async () => {
    const token = await seedProject(PROJECT_A);
    await recipe(PROJECT_A, "Old");
    const answer = await recipes(token);
    expect(entry(answer, "Old")).toMatchObject({ neverUsedEver: true, neverPublishedEver: true });
    expect(entry(answer, "Old")).not.toHaveProperty("archived");
    expect(answer.partial).toBe(false);
  });

  it("never asserts a never flag when the read was incomplete", async () => {
    await seedProject(PROJECT_A);
    await setupPublishing(PROJECT_A);
    const used = await recipe(PROJECT_A, "Used");
    await recipe(PROJECT_A, "Other");
    await publish(PROJECT_A, await mission(PROJECT_A, used));
    await publish(PROJECT_A, await mission(PROJECT_A, undefined));
    const answer = await t.run((ctx) => recipeCatalog(ctx, PROJECT_A, { from: 0, to: Date.now() }, { scanLimit: 1 }));
    expect(answer.partial).toBe(true);
    expect(answer.publicationsScanLimited).toBe(true);
    const other = answer.recipes.find((r) => r.name === "Other")!;
    expect(other.neverUsedEver).toBeUndefined();
    expect(other.neverPublishedEver).toBeUndefined();
    expect(other.usage.lifetime.publications).toBe(0);
  });

  it("is confined to the calling Project, needs an active Run, and discovery exposes no data", async () => {
    const tokenA = await seedProject(PROJECT_A);
    await seedProject(PROJECT_B);
    await recipe(PROJECT_B, "Not mine");
    await recipe(PROJECT_A, "Mine");
    expect(JSON.stringify(await recipes(tokenA))).not.toContain("Not mine");
    const idle = await seedProject("project-idle", false);
    // No Run in progress: the call is refused.
    expect((await call(idle, "list_production_recipes")).error).toBeDefined();
    const list = await (await t.fetch("/internal-mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${idle}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })).json();
    expect(list.result.tools.map((x: { name: string }) => x.name)).toEqual(["list_production_recipes"]);
    expect(JSON.stringify(list)).not.toContain("Mine");
  });
});
