import { insertInstance } from "./instance_fixture";
import { beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { generateAgentToken } from "../internal_mcp/agent_token";
import { installPostiz } from "./postiz_fixture";
import { installAnalyticsAdapter, POSTIZ_ANALYTICS } from "./analytics_fixture";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";

// Issue #114: the Internal MCP's read tools (analytics summary, Publications, Missions, Brand Core), over HTTP.

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
const LIMITED = "example/limited";
const WRITER = "example/writer";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|owner", subject: "owner" };
const DAY = 24 * 3_600_000;
const ALL_TOOLS = ["get_analytics_summary", "list_publications", "list_recent_missions", "list_plan_history", "get_brand_core"];

const internalServer = (tools: string[]) => ({ name: "opengroow", transport: "streamable-http", url: "", internal: { tools } });

useTemplateRegistry(
  [PROJECT_A, PROJECT_B],
  [
    fixtureTemplate(STRATEGIST, { mcpServers: [internalServer(ALL_TOOLS)] }),
    fixtureTemplate(LIMITED, { mcpServers: [internalServer(["get_brand_core"])] }),
    fixtureTemplate(WRITER),
  ],
);

async function seedProject(t: ReturnType<typeof convexTest>, projectId: string, templateId = STRATEGIST) {
  const token = generateAgentToken(projectId, templateId);
  await t.run(async (ctx) => {
    const now = Date.now();
    if (templateId === STRATEGIST) {
      await insertInstance(ctx, { jobId: `job-${projectId}`, status: "running", runtimeStatus: "linked", runtimeReady: true, createdAt: new Date().toISOString(), openclawId: projectId, updatedAt: new Date().toISOString(), userId: OWNER.tokenIdentifier });
    }
    await ctx.db.insert("projectAgents", { instanceId: projectId, templateId, status: "active", mcpServerKeys: ["opengroow"], config: { apiKey: token }, createdAt: now, updatedAt: now });
    const missionId = await ctx.db.insert("missions", { ownerId: "owner", instanceId: projectId, templateId, type: "plan", payload: {}, status: "doing", createdAt: now, updatedAt: now });
    await ctx.db.insert("runs", { missionId, ownerId: "owner", instanceId: projectId, templateId, agentName: "a", sessionKey: `s-${projectId}-${templateId}`, status: "running", createdAt: now, updatedAt: now });
  });
  return token;
}

function call(t: ReturnType<typeof convexTest>, token: string, name: string, args: unknown = {}) {
  return t.fetch("/internal-mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
}
async function result(t: ReturnType<typeof convexTest>, token: string, name: string, args: unknown = {}) {
  const body = await (await call(t, token, name, args)).json();
  return JSON.parse(body.result.content[0].text);
}

let t: ReturnType<typeof convexTest>;
beforeEach(() => {
  t = convexTest(schema, modules);
});

async function seedPublishing() {
  await installPostiz(t);
  await installAnalyticsAdapter(t, POSTIZ_ANALYTICS);
  const owner = t.withIdentity(OWNER);
  await owner.mutation(api.publishers.save, { instanceId: PROJECT_A, adapter: "postiz", url: "https://postiz.example.com", apiKey: "secret" });
  await owner.mutation(api.publishers.addChannel, { adapter: "postiz", instanceId: PROJECT_A, channelId: "ch-1", channelName: "My IG", channelService: "instagram", channelProfile: "me" });
  await owner.mutation(api.publishers.addChannel, { adapter: "postiz", instanceId: PROJECT_A, channelId: "ch-2", channelName: "My TT", channelService: "tiktok", channelProfile: "me" });
  await owner.mutation(api.publishers.setAnalyticsLink, { instanceId: PROJECT_A, adapter: "postiz", target: "tiktok:me", analyticsAdapter: [] });
  return (o: { target: string; type: string; ageDays?: number; metrics?: Record<string, number> }) =>
    t.run(async (ctx) => {
      const now = Date.now();
      const publishedAt = now - (o.ageDays ?? 1) * DAY;
      const missionId = await ctx.db.insert("missions", {
        ownerId: "owner", instanceId: PROJECT_A, templateId: WRITER, type: o.type, name: `Post ${o.type}`,
        payload: {}, lastArtifact: { publishable: { kind: "video", videoUrl: "https://cdn.example.com/v.mp4", caption: "c", title: "A title" } },
        status: "done", createdAt: now, updatedAt: now,
      } as never);
      const publicationId = await ctx.db.insert("publications", { missionId, instanceId: PROJECT_A, target: o.target, status: "published", externalId: "p", externalUrl: "https://example.com/p/1", createdAt: publishedAt, updatedAt: publishedAt } as never);
      await ctx.db.insert("publicationAnalytics", { publicationId, postSeries: 0, instanceId: PROJECT_A, adapter: "postiz-analytics", publisherAdapter: "postiz", publishedAt, delays: [DAY], taken: 0, state: "waiting", nextAt: publishedAt + DAY, done: false, updatedAt: now });
      if (o.metrics) {
        await ctx.db.insert("performanceSnapshots", { publicationId, postSeries: 0, instanceId: PROJECT_A, delayMs: DAY, takenAt: now, metrics: o.metrics, adapter: "postiz-analytics", source: "adapter" });
      }
    });
}

describe("Internal MCP read tools: declaration", () => {
  it("lists the five tools for a Template that declares them, read-only", async () => {
    const token = await seedProject(t, PROJECT_A);
    const response = await t.fetch("/internal-mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const tools = (await response.json()).result.tools as { name: string; annotations: { readOnlyHint: boolean } }[];
    expect(tools.map((tool) => tool.name).sort()).toEqual([...ALL_TOOLS].sort());
    expect(tools.every((tool) => tool.annotations.readOnlyHint)).toBe(true);
  });

  it("refuses each tool to a Template that did not declare it", async () => {
    await seedProject(t, PROJECT_A);
    const token = await seedProject(t, PROJECT_A, LIMITED);
    for (const name of ["get_analytics_summary", "list_publications", "list_recent_missions", "list_plan_history"]) {
      expect((await (await call(t, token, name)).json()).error.code).toBe(-32602);
    }
    expect((await (await call(t, token, "get_brand_core")).json()).result).toBeDefined();
  });
});

describe("get_analytics_summary", () => {
  it("returns the aggregated read, with analytics unavailable apart from no data", async () => {
    const token = await seedProject(t, PROJECT_A);
    const post = await seedPublishing();
    await post({ target: "instagram:me", type: "make_image", metrics: { views: 100, likes: 10 } });
    await post({ target: "instagram:me", type: "make_image", metrics: { views: 900, likes: 10 } });
    await post({ target: "tiktok:me", type: "make_video" });
    const summary = await result(t, token, "get_analytics_summary");
    expect(summary.adapters[0].groups[0]).toMatchObject({ platform: "instagram", format: "video", missionType: "make_image", publications: 2, status: "data" });
    expect(summary.adapters[0].groups[0].metrics.views).toBe(1000);
    expect(summary.unavailable).toEqual([{ platform: "tiktok", format: "video", missionType: "make_video", publications: 1 }]);
  });

  it("honours the days window", async () => {
    const token = await seedProject(t, PROJECT_A);
    const post = await seedPublishing();
    await post({ target: "instagram:me", type: "make_image", ageDays: 20, metrics: { views: 1 } });
    expect((await result(t, token, "get_analytics_summary", { days: 7 })).adapters).toEqual([]);
    expect((await result(t, token, "get_analytics_summary", { days: 30 })).adapters[0].groups[0].publications).toBe(1);
  });
});

describe("list_publications", () => {
  it("returns each Publication with its measurements and tells unavailable from no data", async () => {
    const token = await seedProject(t, PROJECT_A);
    const post = await seedPublishing();
    await post({ target: "instagram:me", type: "make_image", ageDays: 2, metrics: { views: 100 } });
    await post({ target: "instagram:me", type: "make_image", ageDays: 1 });
    await post({ target: "tiktok:me", type: "make_video", ageDays: 3 });
    const publications = await result(t, token, "list_publications");
    // Newest first.
    expect(publications.map((p: { status: string }) => p.status)).toEqual(["no_data", "data", "unavailable"]);
    const measured = publications[1];
    expect(measured).toMatchObject({ platform: "instagram", format: "video", missionType: "make_image", title: "A title", externalUrl: "https://example.com/p/1" });
    expect(measured.measurements).toMatchObject([{ adapter: "postiz-analytics", metrics: { views: 100 } }]);
    expect(publications[0].measurements).toEqual([]);
    expect(publications[2].measurements).toEqual([]);
  });

  it("never returns another Project's Publications", async () => {
    await seedProject(t, PROJECT_A);
    const tokenB = await seedProject(t, PROJECT_B);
    const post = await seedPublishing();
    await post({ target: "instagram:me", type: "make_image", metrics: { views: 1 } });
    expect(await result(t, tokenB, "list_publications")).toEqual([]);
  });
});

describe("list_recent_missions", () => {
  async function mission(projectId: string, fields: Record<string, unknown>) {
    await t.run(async (ctx) => {
      await ctx.db.insert("missions", { ownerId: "owner", instanceId: projectId, templateId: WRITER, type: "create_article", payload: {}, status: "done", createdAt: 1, updatedAt: 1, ...fields } as never);
    });
  }

  it("returns recent Missions with status and outcome, newest first, and never another Project's", async () => {
    const token = await seedProject(t, PROJECT_A);
    await seedProject(t, PROJECT_B);
    // The Agent's own running Mission is of this Project too: it is the newest, so leave it out of the page.
    await mission(PROJECT_A, { name: "Older", updatedAt: 10, lastResult: { status: "success", summary: "Wrote it" } });
    await mission(PROJECT_A, { name: "Broken", status: "failed", updatedAt: 2_000_000_000_000, errorMessage: "boom", lastResult: { status: "failed", summary: "It failed", error: { code: "x", message: "boom" } } });
    await mission(PROJECT_B, { name: "Not mine", updatedAt: 3_000_000_000_000 });
    const all = await result(t, token, "list_recent_missions", { limit: 50 });
    expect(JSON.stringify(all)).not.toContain("Not mine");
    expect(all.map((m: { name?: string }) => m.name).filter(Boolean)).toEqual(["Broken", "Older"]);
    const broken = all.find((m: { name?: string }) => m.name === "Broken");
    expect(broken).toMatchObject({ type: "create_article", status: "failed", outcome: { summary: "It failed", error: "boom" } });
    expect(all.find((m: { name?: string }) => m.name === "Older")).toMatchObject({ status: "done", outcome: { summary: "Wrote it" } });
    expect(await result(t, token, "list_recent_missions", { limit: 1 })).toHaveLength(1);
  });
});

describe("get_brand_core", () => {
  it("returns the Project's Brand Core, and null when it has none", async () => {
    const token = await seedProject(t, PROJECT_A);
    expect(await result(t, token, "get_brand_core")).toBeNull();
    await t.run(async (ctx) => {
      await ctx.db.insert("brandCores", { instanceId: PROJECT_A, audience: "Founders", tone: "Direct", updatedAt: 5 });
      await ctx.db.insert("brandCores", { instanceId: PROJECT_B, audience: "Other", updatedAt: 5 });
    });
    expect(await result(t, token, "get_brand_core")).toEqual({ audience: "Founders", tone: "Direct", updatedAt: 5 });
  });
});

describe("list_plan_history", () => {
  const RESULT = { status: "needs_human_review", summary: "A Plan", reviewQuestions: [] };
  const item = (reason: string) => ({ type: "create_article", payload: { topic: reason }, reason, figures: [{ label: "Reach", value: "5k" }] });

  async function plan(projectId: string, fields: Record<string, unknown>, feedback: string[] = []) {
    return t.run(async (ctx) => {
      const missionId = await ctx.db.insert("missions", { ownerId: "owner", instanceId: projectId, templateId: STRATEGIST, type: "plan", payload: {}, status: "done", createdAt: 1, updatedAt: 1, ...fields } as never);
      for (const [index, humanFeedback] of feedback.entries()) {
        await ctx.db.insert("runs", { missionId, ownerId: "owner", instanceId: projectId, templateId: STRATEGIST, agentName: "a", sessionKey: `s-${missionId}-${index}`, status: "completed", humanFeedback, createdAt: 10 + index, updatedAt: 10 + index } as never);
      }
      return missionId;
    });
  }

  it("returns previous Plans with their items, declined items and the feedback of rejections", async () => {
    const token = await seedProject(t, PROJECT_A);
    const kept = item("Guide to onboarding");
    const declined = item("Listicle of tips");
    await plan(PROJECT_A, { name: "Week 1", updatedAt: 5, lastResult: { ...RESULT, summary: "Week 1", plan: [kept, declined] }, declinedPlanItems: [declined] }, ["Too many articles, propose one reel", "Fewer topics"]);
    const history = await result(t, token, "list_plan_history");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ name: "Week 1", status: "done", items: [kept, declined], declinedItems: [declined], feedback: ["Too many articles, propose one reel", "Fewer topics"] });
  });

  it("leaves out Missions that are not Plans and keeps newest first", async () => {
    const token = await seedProject(t, PROJECT_A);
    await plan(PROJECT_A, { name: "Old", updatedAt: 2, lastResult: { ...RESULT, plan: [item("a")] } });
    await plan(PROJECT_A, { name: "New", updatedAt: 9, status: "to_validate", lastResult: { ...RESULT, plan: [item("b")] } });
    await plan(PROJECT_A, { name: "Article", type: "create_article", updatedAt: 20, lastResult: { ...RESULT } });
    const history = await result(t, token, "list_plan_history");
    expect(history.map((entry: { name: string }) => entry.name)).toEqual(["New", "Old"]);
    expect((await result(t, token, "list_plan_history", { limit: 1 }))).toHaveLength(1);
  });

  it("returns only the Project's own history", async () => {
    const token = await seedProject(t, PROJECT_A);
    await seedProject(t, PROJECT_B);
    await plan(PROJECT_A, { name: "Mine", lastResult: { ...RESULT, plan: [item("a")] } }, ["mine"]);
    await plan(PROJECT_B, { name: "Theirs", lastResult: { ...RESULT, plan: [item("b")] } }, ["theirs"]);
    const history = await result(t, token, "list_plan_history");
    expect(JSON.stringify(history)).not.toContain("Theirs");
    expect(JSON.stringify(history)).not.toContain("theirs");
    expect(history).toHaveLength(1);
  });
});
