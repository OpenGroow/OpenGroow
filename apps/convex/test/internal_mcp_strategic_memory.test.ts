import { insertInstance } from "./instance_fixture";
import { beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { generateAgentToken } from "../internal_mcp/agent_token";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";

// Issue #165: the Internal MCP's get_strategic_memory tool, over HTTP.

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
const LIMITED = "example/limited";
const OWNER = "test|owner";

const internalServer = (tools: string[]) => ({ name: "opengroow", transport: "streamable-http", url: "", internal: { tools } });

useTemplateRegistry(
  [PROJECT_A, PROJECT_B],
  [fixtureTemplate(STRATEGIST, { mcpServers: [internalServer(["get_strategic_memory"])] }), fixtureTemplate(LIMITED, { mcpServers: [internalServer(["get_brand_core"])] })],
);

async function seedProject(t: ReturnType<typeof convexTest>, projectId: string, templateId = STRATEGIST, runStatus = "running") {
  const token = generateAgentToken(projectId, templateId);
  const runId = await t.run(async (ctx) => {
    const now = Date.now();
    await insertInstance(ctx, { jobId: `job-${projectId}-${templateId}`, status: "running", runtimeStatus: "linked", runtimeReady: true, createdAt: new Date().toISOString(), openclawId: projectId, updatedAt: new Date().toISOString(), userId: OWNER });
    await ctx.db.insert("projectAgents", { instanceId: projectId, templateId, status: "active", mcpServerKeys: ["opengroow"], config: { apiKey: token }, createdAt: now, updatedAt: now });
    const missionId = await ctx.db.insert("missions", { ownerId: "owner", instanceId: projectId, templateId, type: "report", payload: {}, status: "doing", createdAt: now, updatedAt: now });
    return await ctx.db.insert("runs", { missionId, ownerId: "owner", instanceId: projectId, templateId, agentName: "a", sessionKey: `s-${projectId}-${templateId}`, status: runStatus as "running", createdAt: now, updatedAt: now });
  });
  return { token, runId };
}

async function addReview(t: ReturnType<typeof convexTest>, projectId: string, runId: never, o: { memory: string; createdAt: number }) {
  return await t.run(async (ctx) =>
    ctx.db.insert("strategicReviews", {
      ownerId: "owner", instanceId: projectId, runId,
      periodStart: 1_000, periodEnd: 2_000, report: "SECRET REPORT BODY", consolidatedMemory: o.memory,
      references: { familyIds: [], recipeIds: [], publicationIds: [] }, memoryChanged: true, createdAt: o.createdAt,
    }),
  );
}

function call(t: ReturnType<typeof convexTest>, token: string, name: string) {
  return t.fetch("/internal-mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }),
  });
}
async function memory(t: ReturnType<typeof convexTest>, token: string) {
  const body = await (await call(t, token, "get_strategic_memory")).json();
  return JSON.parse(body.result.content[0].text);
}

let t: ReturnType<typeof convexTest>;
beforeEach(() => {
  t = convexTest(schema, modules);
});

describe("get_strategic_memory", () => {
  it("is listed read-only for a Template that declares it", async () => {
    const { token } = await seedProject(t, PROJECT_A);
    const response = await t.fetch("/internal-mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    const tools = (await response.json()).result.tools as { name: string; annotations: { readOnlyHint: boolean } }[];
    expect(tools).toMatchObject([{ name: "get_strategic_memory", annotations: { readOnlyHint: true } }]);
  });

  it("says explicitly that no Review exists yet", async () => {
    const { token } = await seedProject(t, PROJECT_A);
    expect(await memory(t, token)).toMatchObject({ exists: false });
  });

  it("returns the latest Review's identity, period, memory, references and date, never the report", async () => {
    const { token, runId } = await seedProject(t, PROJECT_A);
    await addReview(t, PROJECT_A, runId as never, { memory: "old memory", createdAt: 100 });
    const latest = await addReview(t, PROJECT_A, runId as never, { memory: "# Current memory", createdAt: 200 });
    const out = await memory(t, token);
    expect(out).toEqual({
      exists: true,
      reviewId: latest,
      periodStart: 1_000,
      periodEnd: 2_000,
      memory: "# Current memory",
      references: { familyIds: [], recipeIds: [], publicationIds: [] },
      createdAt: 200,
    });
    expect(JSON.stringify(out)).not.toContain("SECRET REPORT BODY");
  });

  it("never reads another Project's Review", async () => {
    const { token } = await seedProject(t, PROJECT_A);
    const other = await seedProject(t, PROJECT_B);
    await addReview(t, PROJECT_B, other.runId as never, { memory: "other project memory", createdAt: 300 });
    expect(await memory(t, token)).toMatchObject({ exists: false });
  });

  it("is refused to a Template that did not declare it", async () => {
    const { token } = await seedProject(t, PROJECT_A, LIMITED);
    expect((await (await call(t, token, "get_strategic_memory")).json()).error.code).toBe(-32602);
  });

  it("is refused outside a running Run", async () => {
    const { token } = await seedProject(t, PROJECT_A, STRATEGIST, "completed");
    expect((await call(t, token, "get_strategic_memory")).status).toBe(403);
  });
});
