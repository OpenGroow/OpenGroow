import { insertInstance } from "./instance_fixture";
import { beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { generateAgentToken } from "../internal_mcp/agent_token";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";
import type { Id } from "../_generated/dataModel";

// Issue #178: the Internal MCP's read tools for Content Planning, over HTTP.

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
  "../instances.ts": () => import("../instances.js"),
};

const PROJECT_A = "project-a";
const PROJECT_B = "project-b";
const PLANNER = "example/planner";
const LIMITED = "example/limited";
const OWNER = { tokenIdentifier: "test|owner" };
const TOOLS = ["list_mission_types", "list_production_recipes", "list_sources", "list_planned_contents"];
const internalServer = (tools: string[]) => ({ name: "opengroow", transport: "streamable-http", url: "", internal: { tools } });

useTemplateRegistry(
  [PROJECT_A, PROJECT_B],
  [
    fixtureTemplate(PLANNER, {
      mcpServers: [internalServer(TOOLS)],
      missionTypes: [
        { type: "make_image", label: "Make image", agentsMd: "a.md", publish: { kind: "image", platforms: ["instagram"] }, contextProviders: ["observation-production-source"] },
        { type: "write_article", label: "Write article", agentsMd: "b.md", publish: { kind: "article" } },
        { type: "internal_note", label: "Note", agentsMd: "c.md" },
      ],
    } as never),
    fixtureTemplate(LIMITED, { mcpServers: [internalServer(["get_brand_core"])] }),
  ],
);

let t: ReturnType<typeof convexTest>;
beforeEach(() => {
  t = convexTest(schema, modules);
});

async function seedProject(projectId: string, templateId = PLANNER, runStatus = "running") {
  const token = generateAgentToken(projectId, templateId);
  await t.run(async (ctx) => {
    const now = Date.now();
    if (templateId === PLANNER) await insertInstance(ctx, { jobId: `job-${projectId}`, status: "running", runtimeStatus: "linked", runtimeReady: true, createdAt: new Date().toISOString(), openclawId: projectId, updatedAt: new Date().toISOString(), userId: OWNER.tokenIdentifier });
    await ctx.db.insert("projectAgents", { instanceId: projectId, templateId, status: "active", mcpServerKeys: ["opengroow"], config: { apiKey: token }, createdAt: now, updatedAt: now });
    const missionId = await ctx.db.insert("missions", { ownerId: "owner", instanceId: projectId, templateId, type: "report", payload: {}, status: "doing", createdAt: now, updatedAt: now });
    await ctx.db.insert("runs", { missionId, ownerId: "owner", instanceId: projectId, templateId, agentName: "a", sessionKey: `s-${projectId}-${templateId}`, status: runStatus as never, createdAt: now, updatedAt: now });
  });
  return token;
}

async function raw(token: string, name: string, args: unknown = {}) {
  return t.fetch("/internal-mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
}
async function call(token: string, name: string, args: unknown = {}) {
  const body = await (await raw(token, name, args)).json();
  if (body.error) throw new Error(body.error.message);
  const result = body.result;
  if (result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
}

async function family(projectId: string, name: string) {
  return t.run((ctx) => ctx.db.insert("creativeFamilies", { instanceId: projectId, slug: name.toLowerCase(), name, description: "d" }));
}
async function recipe(projectId: string, creativeFamilyId: Id<"creativeFamilies">, name: string, missionType: string, templateId = PLANNER) {
  return t.run((ctx) => ctx.db.insert("productionRecipes", { instanceId: projectId, creativeFamilyId, templateId, missionType, name, description: "d" }));
}
async function source(projectId: string, label: string, o: { status?: string; capturedAt?: number; scoring?: Record<string, number>; producedAt?: number; selectedAt?: number; creativeFamilyId?: Id<"creativeFamilies">; summary?: string } = {}) {
  return t.run((ctx) =>
    ctx.db.insert("sources", {
      instanceId: projectId, ownerId: "owner", templateId: "example/source", sourceId: "post", label, family: "fam", status: (o.status ?? "ready") as never,
      origin: "https://example.com/p", capturedAt: o.capturedAt ?? 1000, createdAt: o.capturedAt ?? 1000, marketing: o.summary ? { summary: o.summary } : {}, analysis: { big: "payload" },
      ...(o.scoring ? { scoring: o.scoring } : {}),
      ...(o.creativeFamilyId ? { creativeFamilyId: o.creativeFamilyId } : {}),
    } as never),
  );
}
async function planned(projectId: string, recipeId: Id<"productionRecipes">, plannedAt: string, o: { status?: string; title?: string } = {}) {
  return t.run(async (ctx) => {
    const planId = await ctx.db.insert("contentPlans", { ownerId: "owner", instanceId: projectId, runId: (await ctx.db.query("runs").first())!._id, periodStart: "2026-12-01", periodEnd: "2026-12-31", rationale: "r", status: "approved", createdAt: 1 } as never);
    return ctx.db.insert("plannedContents", { ownerId: "owner", instanceId: projectId, planId, kind: "image", missionType: "make_image", recipeId, publishTargets: ["t1"], title: o.title ?? "T", brief: "b", plannedAt, intent: "explore", rationale: "r", status: (o.status ?? "approved") as never, createdAt: 1 } as never);
  });
}

describe("list_mission_types and list_production_recipes: format and Source requirement", () => {
  it("returns kind, platforms and sourceRequired per Mission type", async () => {
    const token = await seedProject(PROJECT_A);
    const types = await call(token, "list_mission_types");
    expect(types).toEqual([
      expect.objectContaining({ type: "internal_note", kind: null, platforms: [], sourceRequired: false }),
      expect.objectContaining({ type: "make_image", label: "Make image", kind: "image", platforms: ["instagram"], sourceRequired: true }),
      expect.objectContaining({ type: "write_article", kind: "article", platforms: [], sourceRequired: false }),
    ]);
  });

  it("returns kind and sourceRequired per recipe, keeping the existing fields", async () => {
    const token = await seedProject(PROJECT_A);
    const f = await family(PROJECT_A, "F");
    await recipe(PROJECT_A, f, "Image recipe", "make_image");
    await recipe(PROJECT_A, f, "Article recipe", "write_article");
    await recipe(PROJECT_A, f, "Orphan", "gone_type", "example/uninstalled");
    const out = await call(token, "list_production_recipes");
    const by = (name: string) => out.recipes.find((r: { name: string }) => r.name === name);
    expect(by("Image recipe")).toMatchObject({ kind: "image", sourceRequired: true, missionType: "make_image" });
    expect(by("Article recipe")).toMatchObject({ kind: "article", sourceRequired: false });
    expect(by("Orphan")).toMatchObject({ kind: null, sourceRequired: false });
    expect(out).toHaveProperty("total", 3);
  });
});

describe("list_sources", () => {
  it("returns the documented fields without the full analysis", async () => {
    const token = await seedProject(PROJECT_A);
    const f = await family(PROJECT_A, "Hooks");
    const id = await source(PROJECT_A, "Post one", { scoring: { replicationScore: 0.8, productFit: 0.9, replicability: 0.7, creativeStrength: 0.6 }, creativeFamilyId: f, summary: "A short summary" });
    const out = await call(token, "list_sources");
    expect(out.sources).toEqual([
      {
        sourceId: id, label: "Post one", origin: "https://example.com/p", status: "ready", capturedAt: 1000,
        replicationScore: 0.8, scores: { productFit: 0.9, replicability: 0.7, creativeStrength: 0.6 },
        summary: "A short summary", creativeFamily: { id: f, name: "Hooks" },
      },
    ]);
    expect(out.truncated).toBe(false);
    expect(JSON.stringify(out)).not.toContain("payload");
  });

  it("serves the best Replication Score first, then the newest", async () => {
    const token = await seedProject(PROJECT_A);
    await source(PROJECT_A, "low", { scoring: { replicationScore: 0.2 }, capturedAt: 20 });
    await source(PROJECT_A, "high", { scoring: { replicationScore: 0.7 }, capturedAt: 10 });
    await source(PROJECT_A, "high newer", { scoring: { replicationScore: 0.7 }, capturedAt: 30 });
    const out = await call(token, "list_sources");
    expect(out.sources.map((s: { label: string }) => s.label)).toEqual(["high newer", "high", "low"]);
    expect(out.sources[0]).not.toHaveProperty("produced");
    expect(out.sources[0]).not.toHaveProperty("selected");
  });

  it("filters by status (ready by default)", async () => {
    const token = await seedProject(PROJECT_A);
    await source(PROJECT_A, "ready one");
    await source(PROJECT_A, "failed one", { status: "failed" });
    expect((await call(token, "list_sources")).sources.map((s: { label: string }) => s.label)).toEqual(["ready one"]);
    expect((await call(token, "list_sources", { status: "failed" })).sources.map((s: { label: string }) => s.label)).toEqual(["failed one"]);
    await expect(call(token, "list_sources", { status: "bogus" })).rejects.toThrow(/status/);
  });

  it("bounds the page size", async () => {
    const token = await seedProject(PROJECT_A);
    for (let i = 0; i < 3; i++) await source(PROJECT_A, `s${i}`, { capturedAt: 100 + i });
    const small = await call(token, "list_sources", { limit: 2 });
    expect(small.sources).toHaveLength(2);
    expect(small.truncated).toBe(true);
    const huge = await call(token, "list_sources", { limit: 100000 });
    expect(huge.sources).toHaveLength(3);
  });

  it("never reads another Project's Sources", async () => {
    const token = await seedProject(PROJECT_A);
    await source(PROJECT_B, "other");
    expect((await call(token, "list_sources")).sources).toEqual([]);
  });
});

describe("list_planned_contents", () => {
  it("returns Planned Contents of the range, by date, with their documented fields", async () => {
    const token = await seedProject(PROJECT_A);
    const r = await recipe(PROJECT_A, await family(PROJECT_A, "F"), "R", "make_image");
    const late = await planned(PROJECT_A, r, "2026-12-20", { title: "late" });
    const early = await planned(PROJECT_A, r, "2026-12-05", { title: "early" });
    await planned(PROJECT_A, r, "2027-03-01", { title: "outside" });
    const out = await call(token, "list_planned_contents", { from: "2026-12-01", to: "2026-12-31" });
    expect(out.plannedContents.map((p: { title: string }) => p.title)).toEqual(["early", "late"]);
    expect(out.plannedContents[0]).toEqual({
      plannedContentId: early, planId: expect.any(String), kind: "image", missionType: "make_image", recipeId: r, publishTargets: ["t1"],
      title: "early", brief: "b", plannedAt: "2026-12-05", intent: "explore", rationale: "r", status: "approved", createdAt: 1,
    });
    expect(late).toBeTruthy();
    expect(out.truncated).toBe(false);
  });

  it("filters by status", async () => {
    const token = await seedProject(PROJECT_A);
    const r = await recipe(PROJECT_A, await family(PROJECT_A, "F"), "R", "make_image");
    await planned(PROJECT_A, r, "2026-12-05", { status: "proposed", title: "p" });
    await planned(PROJECT_A, r, "2026-12-06", { status: "approved", title: "a" });
    const range = { from: "2026-12-01", to: "2026-12-31" };
    expect((await call(token, "list_planned_contents", range)).plannedContents).toHaveLength(2);
    expect((await call(token, "list_planned_contents", { ...range, status: "proposed" })).plannedContents.map((p: { title: string }) => p.title)).toEqual(["p"]);
    await expect(call(token, "list_planned_contents", { ...range, status: "x" })).rejects.toThrow(/status/);
  });

  it("enforces the date range bounds and format", async () => {
    const token = await seedProject(PROJECT_A);
    await expect(call(token, "list_planned_contents", { from: "2026-12-01", to: "2027-12-01" })).rejects.toThrow(/at most/);
    await expect(call(token, "list_planned_contents", { from: "2026-12-10", to: "2026-12-01" })).rejects.toThrow(/before/);
    await expect(call(token, "list_planned_contents", { from: "12/01/2026", to: "2026-12-05" })).rejects.toThrow(/YYYY-MM-DD/);
    await expect(call(token, "list_planned_contents", { from: "2026-02-30", to: "2026-03-05" })).rejects.toThrow(/YYYY-MM-DD/);
    await expect(call(token, "list_planned_contents", { from: "2026-12-01" })).rejects.toThrow(/from and to/);
  });

  it("bounds the page size", async () => {
    const token = await seedProject(PROJECT_A);
    const r = await recipe(PROJECT_A, await family(PROJECT_A, "F"), "R", "make_image");
    for (const d of ["2026-12-01", "2026-12-02", "2026-12-03"]) await planned(PROJECT_A, r, d);
    const out = await call(token, "list_planned_contents", { from: "2026-12-01", to: "2026-12-31", limit: 2 });
    expect(out.plannedContents).toHaveLength(2);
    expect(out.truncated).toBe(true);
  });

  it("never reads another Project's Planned Contents", async () => {
    const token = await seedProject(PROJECT_A);
    await seedProject(PROJECT_B);
    const rb = await recipe(PROJECT_B, await family(PROJECT_B, "F"), "R", "make_image");
    await planned(PROJECT_B, rb, "2026-12-05");
    expect((await call(token, "list_planned_contents", { from: "2026-12-01", to: "2026-12-31" })).plannedContents).toEqual([]);
  });
});

describe("permissions", () => {
  it("lists the new tools read-only for a Template that declares them", async () => {
    const token = await seedProject(PROJECT_A);
    const response = await t.fetch("/internal-mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    const tools = (await response.json()).result.tools as { name: string; annotations: { readOnlyHint: boolean } }[];
    expect(tools.map((x) => x.name).sort()).toEqual([...TOOLS].sort());
    expect(tools.every((x) => x.annotations.readOnlyHint)).toBe(true);
  });

  it("refuses an undeclared tool", async () => {
    const token = await seedProject(PROJECT_A, LIMITED);
    for (const name of ["list_sources", "list_planned_contents"]) expect((await (await raw(token, name)).json()).error.code).toBe(-32602);
  });

  it("refuses a call without a running Run", async () => {
    const token = await seedProject(PROJECT_A, PLANNER, "completed");
    expect((await raw(token, "list_sources")).status).toBe(403);
    expect((await raw(token, "list_planned_contents", { from: "2026-12-01", to: "2026-12-02" })).status).toBe(403);
  });
});
