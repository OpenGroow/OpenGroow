import { insertInstance } from "./instance_fixture";
import { beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { generateAgentToken } from "../internal_mcp/agent_token";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";
import type { Id } from "../_generated/dataModel";

// ADR-087 (ticket #190): the Internal MCP's Creative Family tools, locked to the running Recipe Generation.

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
const STRATEGIST = "example/strategist";
const TOOLS = ["list_mission_types", "list_sources", "list_generation_sources", "get_source", "get_production_recipe"];
const internalServer = (tools: string[]) => ({ name: "opengroow", transport: "streamable-http", url: "", internal: { tools } });

useTemplateRegistry(
  [PROJECT_A, PROJECT_B],
  [
    fixtureTemplate(STRATEGIST, {
      mcpServers: [internalServer(TOOLS)],
      missionTypes: [
        { type: "make_image", label: "Make image", agentsMd: "a.md", publish: { kind: "image" }, contextProviders: ["production-recipe"] },
        { type: "note", label: "Note", agentsMd: "b.md" },
      ],
    } as never),
  ],
);

let t: ReturnType<typeof convexTest>;
beforeEach(() => {
  t = convexTest(schema, modules);
});

/** A Project with a Strategist Agent; `runKind` picks what its running Run is. */
async function seed(projectId: string, runKind: "standalone" | "mission" = "standalone") {
  const token = generateAgentToken(projectId, STRATEGIST);
  const runId = await t.run(async (ctx) => {
    const now = Date.now();
    await insertInstance(ctx, { jobId: `job-${projectId}`, status: "running", runtimeStatus: "linked", runtimeReady: true, createdAt: new Date().toISOString(), openclawId: projectId, updatedAt: new Date().toISOString(), userId: "test|owner" });
    await ctx.db.insert("projectAgents", { instanceId: projectId, templateId: STRATEGIST, status: "active", mcpServerKeys: ["opengroow"], config: { apiKey: token }, createdAt: now, updatedAt: now });
    const base = { ownerId: "owner", instanceId: projectId, templateId: STRATEGIST, agentName: "a", sessionKey: `s-${projectId}`, status: "running" as const, createdAt: now, updatedAt: now };
    if (runKind === "standalone") return await ctx.db.insert("runs", { ...base, recipeGeneration: { sourceIds: [], tryCount: 1 } });
    const missionId = await ctx.db.insert("missions", { ownerId: "owner", instanceId: projectId, templateId: STRATEGIST, type: "report", payload: {}, status: "doing", createdAt: now, updatedAt: now });
    return await ctx.db.insert("runs", { ...base, missionId });
  });
  return { token, runId };
}

/** Gives these Sources to the running generation, as `generateRecipe` pins them when it starts. */
const give = (runId: Id<"runs">, sourceIds: Id<"sources">[]) => t.run((ctx) => ctx.db.patch(runId, { recipeGeneration: { sourceIds, tryCount: 1 } }));

async function raw(token: string, name: string, args: unknown = {}) {
  return t.fetch("/internal-mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
}
/** The tool's parsed result, or its error text under `error`. */
async function call(token: string, name: string, args: unknown = {}) {
  const body = await (await raw(token, name, args)).json();
  const result = body.result;
  if (result.isError) return { error: result.content[0].text as string };
  return JSON.parse(result.content[0].text);
}

async function source(projectId: string, label: string, o: { status?: string; capturedAt?: number; replicationScore?: number; producedAt?: number; excluded?: boolean; familyId?: Id<"creativeFamilies"> } = {}) {
  const at = o.capturedAt ?? 1000;
  return t.run((ctx) =>
    ctx.db.insert("sources", {
      instanceId: projectId, ownerId: "owner", templateId: "example/source", sourceId: "post", label, family: "fam", status: (o.status ?? "ready") as never,
      origin: "https://example.com/p", capturedAt: at, createdAt: at, marketing: { summary: `about ${label}` }, analysis: { hook: `hook of ${label}` },
      ...(o.replicationScore !== undefined ? { scoring: { replicationScore: o.replicationScore } } : {}),
      ...(o.producedAt ? { producedAt: o.producedAt } : {}), ...(o.excluded ? { excluded: true } : {}),
    } as never),
  );
}

describe("generation tools are locked to a running Recipe Generation", () => {
  it("list_generation_sources is refused when the Agent runs a Mission, not a generation", async () => {
    const { token } = await seed(PROJECT_A, "mission");
    expect((await call(token, "list_generation_sources")).error).toMatch(/Recipe Generation/);
  });

  it("get_source is refused outside a generation", async () => {
    const { token } = await seed(PROJECT_A, "mission");
    const id = await source(PROJECT_A, "S");
    expect((await call(token, "get_source", { sourceId: id })).error).toMatch(/Recipe Generation/);
  });

  it("get_creative_family no longer exists", async () => {
    const { token } = await seed(PROJECT_A);
    const body = await (await raw(token, "get_creative_family")).json();
    expect(body.error ?? body.result?.isError).toBeTruthy();
  });

  it("list_sources is refused during a generation: the Agent reads only what it was given", async () => {
    const { token } = await seed(PROJECT_A);
    expect((await call(token, "list_sources")).error).toMatch(/list_generation_sources/);
  });
});

describe("list_generation_sources", () => {
  it("lists only the ready, non-excluded Sources given to the generation, as light rows", async () => {
    const { token, runId } = await seed(PROJECT_A);
    const keep = await source(PROJECT_A, "keep", { replicationScore: 0.7 });
    const processing = await source(PROJECT_A, "processing", { status: "processing" });
    const excluded = await source(PROJECT_A, "excluded", { excluded: true });
    await source(PROJECT_A, "not given");
    await give(runId, [keep, processing, excluded]);
    const out = await call(token, "list_generation_sources");
    expect(out.sources).toEqual([expect.objectContaining({ sourceId: keep, label: "keep", replicationScore: 0.7, produced: false })]);
    expect(JSON.stringify(out)).not.toContain("hook of keep");
  });

  it("is empty for a generation started from an idea alone", async () => {
    const { token } = await seed(PROJECT_A);
    await source(PROJECT_A, "not given");
    expect((await call(token, "list_generation_sources")).sources).toEqual([]);
  });

  it("sorts recent by default or by score, filters, and paginates with a cursor", async () => {
    const { token, runId } = await seed(PROJECT_A);
    const given = [
      await source(PROJECT_A, "old-best", { capturedAt: 1000, replicationScore: 0.9 }),
      await source(PROJECT_A, "mid", { capturedAt: 2000, replicationScore: 0.5, producedAt: 5 }),
      await source(PROJECT_A, "new-worst", { capturedAt: 3000, replicationScore: 0.1 }),
    ];
    await give(runId, given);
    const labels = (o: { sources: { label: string }[] }) => o.sources.map((s) => s.label);
    expect(labels(await call(token, "list_generation_sources"))).toEqual(["new-worst", "mid", "old-best"]);
    expect(labels(await call(token, "list_generation_sources", { sort: "score" }))).toEqual(["old-best", "mid", "new-worst"]);
    expect(labels(await call(token, "list_generation_sources", { minReplicationScore: 0.5 }))).toEqual(["mid", "old-best"]);
    expect(labels(await call(token, "list_generation_sources", { produced: true }))).toEqual(["mid"]);
    const first = await call(token, "list_generation_sources", { limit: 2 });
    expect(labels(first)).toEqual(["new-worst", "mid"]);
    expect(first.nextCursor).toBeTypeOf("string");
    const second = await call(token, "list_generation_sources", { limit: 2, cursor: first.nextCursor });
    expect(labels(second)).toEqual(["old-best"]);
    expect(second.nextCursor).toBeUndefined();
  });

  it("caps the page size at 25 and defaults to 10", async () => {
    const { token, runId } = await seed(PROJECT_A);
    const given: Id<"sources">[] = [];
    for (let i = 0; i < 25; i++) given.push(await source(PROJECT_A, `s${i}`, { capturedAt: 1000 + i }));
    await give(runId, given);
    expect((await call(token, "list_generation_sources", { limit: 100 })).sources).toHaveLength(25);
    expect((await call(token, "list_generation_sources")).sources).toHaveLength(10);
  });
});

describe("get_source", () => {
  it("returns a Source given to the generation in full", async () => {
    const { token, runId } = await seed(PROJECT_A);
    const id = await source(PROJECT_A, "full", { replicationScore: 0.8 });
    await give(runId, [id]);
    const out = await call(token, "get_source", { sourceId: id });
    expect(out).toMatchObject({ sourceId: id, label: "full", analysis: { hook: "hook of full" }, scoring: { replicationScore: 0.8 }, marketing: { summary: "about full" } });
  });

  it("refuses a Source that was not given, not ready, excluded, or of another Project, with a readable reason", async () => {
    const { token, runId } = await seed(PROJECT_A);
    const notGiven = await source(PROJECT_A, "x");
    const unready = await source(PROJECT_A, "y", { status: "processing" });
    const excluded = await source(PROJECT_A, "z", { excluded: true });
    await give(runId, [unready, excluded]);
    await seed(PROJECT_B);
    const foreign = await source(PROJECT_B, "w");
    for (const id of [notGiven, unready, excluded, foreign, "nope"]) {
      expect((await call(token, "get_source", { sourceId: id })).error).toMatch(/given to this generation/);
    }
  });
});

describe("get_production_recipe", () => {
  it("returns a recipe with its target and latest version, and refuses another Project's", async () => {
    const { token } = await seed(PROJECT_A);
    const recipeId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("productionRecipes", { instanceId: PROJECT_A, templateId: STRATEGIST, missionType: "make_image", name: "R", description: "d", status: "active" });
      await ctx.db.insert("productionRecipeVersions", { instanceId: PROJECT_A, recipeId: id, version: 1, instructions: "old", constraints: [], createdAt: 1 });
      await ctx.db.insert("productionRecipeVersions", { instanceId: PROJECT_A, recipeId: id, version: 2, instructions: "new", prompt: "p", constraints: ["c"], createdAt: 2 });
      return id;
    });
    const out = await call(token, "get_production_recipe", { recipeId });
    expect(out).toMatchObject({ recipeId, name: "R", templateId: STRATEGIST, missionType: "make_image", latestVersion: { version: 2, instructions: "new", prompt: "p", constraints: ["c"] } });
    expect(out).not.toHaveProperty("creativeFamily");
    await seed(PROJECT_B);
    const foreign = await t.run((ctx) => ctx.db.insert("productionRecipes", { instanceId: PROJECT_B, templateId: STRATEGIST, missionType: "make_image", name: "F", description: "d", status: "active" }));
    expect((await call(token, "get_production_recipe", { recipeId: foreign })).error).toMatch(/not found/);
  });
});
