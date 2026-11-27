import { insertInstance } from "./instance_fixture";
import { beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { AgentTemplate } from "@opengroow/agent-templates";
import schema from "../schema";
import { generateAgentToken } from "../internal_mcp/agent_token";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";

// The Internal MCP (ADR-080) over HTTP: JSON-RPC requests to the stateless
// route, as the OpenClaw runtime sends them.

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
};

const PROJECT_A = "project-a";
const PROJECT_B = "project-b";
const READER = "example/reader";
const WRITER = "example/writer";
const PLAIN = "example/plain";
const NARROW = "example/narrow";

const internalServer = (tools: string[]) => ({
  name: "opengroow",
  transport: "streamable-http",
  url: "",
  internal: { tools },
});

const reader = (tools: string[] = ["list_mission_types"]): AgentTemplate =>
  fixtureTemplate(READER, { mcpServers: [internalServer(tools)] });

const writer: AgentTemplate = fixtureTemplate(WRITER, {
  name: "Writer",
  description: "Writes articles.",
  missionTypes: [
    { type: "create_article", label: "Create an article", description: "Writes one article.", payload: "{}", agentsMd: "a.md" },
    { type: "create_letter_video", label: "Create a letter video", payload: "{}", agentsMd: "b.md" },
  ],
});

useTemplateRegistry(
  [PROJECT_A, PROJECT_B],
  [
    reader(),
    writer,
    fixtureTemplate(PLAIN),
    // Declares a tool the catalog does not have (an old or hand-built Template skips validation).
    fixtureTemplate(NARROW, { mcpServers: [internalServer(["get_weather"])] }),
  ],
);

let tokenA: string;

async function seedProject(t: ReturnType<typeof convexTest>, projectId: string, token: string, opts: { run?: "running" | "pending" | "none" } = {}) {
  const now = Date.now();
  await t.run(async (ctx) => {
    await insertInstance(ctx, {
      jobId: `job-${projectId}`,
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: new Date().toISOString(),
      openclawId: projectId,
      updatedAt: new Date().toISOString(),
      userId: "owner",
    });
    await ctx.db.insert("projectAgents", {
      instanceId: projectId,
      templateId: READER,
      status: "active",
      mcpServerKeys: ["opengroow"],
      config: { apiKey: token },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("projectAgents", {
      instanceId: projectId,
      templateId: WRITER,
      status: "active",
      mcpServerKeys: [],
      hiddenMissionTypes: projectId === PROJECT_B ? ["create_letter_video"] : [],
      createdAt: now,
      updatedAt: now,
    });
    if (opts.run !== "none") {
      const missionId = await ctx.db.insert("missions", {
        ownerId: "owner",
        instanceId: projectId,
        templateId: READER,
        type: "report",
        payload: {},
        status: "doing",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("runs", {
        missionId,
        ownerId: "owner",
        instanceId: projectId,
        templateId: READER,
        agentName: "reader",
        sessionKey: `s-${projectId}`,
        status: opts.run ?? "running",
        createdAt: now,
        updatedAt: now,
      });
    }
  });
}

function rpc(t: ReturnType<typeof convexTest>, token: string | undefined, body: unknown) {
  return t.fetch("/internal-mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

const listTools = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const callTool = (name: string, args: unknown = {}) => ({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });

beforeEach(() => {
  tokenA = generateAgentToken(PROJECT_A, READER);
});

describe("Internal MCP endpoint: authentication", () => {
  it("refuses a call without a token", async () => {
    const t = convexTest(schema, modules);
    await seedProject(t, PROJECT_A, tokenA);
    expect((await rpc(t, undefined, listTools)).status).toBe(401);
  });

  it("refuses a wrong token", async () => {
    const t = convexTest(schema, modules);
    await seedProject(t, PROJECT_A, tokenA);
    expect((await rpc(t, "nonsense", listTools)).status).toBe(401);
    expect((await rpc(t, generateAgentToken(PROJECT_A, READER), listTools)).status).toBe(401);
  });

  it("refuses a token of another Project, even one forged with this Project's identity", async () => {
    const t = convexTest(schema, modules);
    const tokenB = generateAgentToken(PROJECT_B, READER);
    await seedProject(t, PROJECT_A, tokenA);
    await seedProject(t, PROJECT_B, tokenB);
    // Project B's secret presented as Project A's identity.
    const forged = `${tokenA.split(".")[0]}.${tokenB.split(".")[1]}`;
    expect((await rpc(t, forged, listTools)).status).toBe(401);
  });

  it("refuses to call a tool when the Agent has no Run in progress", async () => {
    const t = convexTest(schema, modules);
    await seedProject(t, PROJECT_A, tokenA, { run: "pending" });
    const response = await rpc(t, tokenA, callTool("list_mission_types"));
    expect(response.status).toBe(403);
  });

  it("lists the declared tools without a Run: the runtime probes the server before it starts the Agent", async () => {
    const t = convexTest(schema, modules);
    await seedProject(t, PROJECT_A, tokenA, { run: "pending" });
    const response = await rpc(t, tokenA, listTools);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools.map((tool) => tool.name)).toEqual(["list_mission_types"]);
  });

  it("still refuses to list tools for an invalid token", async () => {
    const t = convexTest(schema, modules);
    await seedProject(t, PROJECT_A, tokenA, { run: "pending" });
    expect((await rpc(t, "not-a-token", listTools)).status).toBe(401);
  });

  it("accepts the token during a Run", async () => {
    const t = convexTest(schema, modules);
    await seedProject(t, PROJECT_A, tokenA);
    expect((await rpc(t, tokenA, listTools)).status).toBe(200);
  });

  it("does not answer a GET (stateless: no server stream)", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch("/internal-mcp", { method: "GET", headers: { Authorization: `Bearer ${tokenA}` } });
    expect(response.status).toBe(405);
  });
});

describe("Internal MCP endpoint: protocol", () => {
  it("initializes with the tools capability and plain JSON", async () => {
    const t = convexTest(schema, modules);
    await seedProject(t, PROJECT_A, tokenA);
    const response = await rpc(t, tokenA, {
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "probe", version: "1" } },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("mcp-session-id")).toBeNull();
    const body = await response.json();
    expect(body).toMatchObject({ jsonrpc: "2.0", id: 0, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} } } });
  });

  it("acknowledges a notification without a body", async () => {
    const t = convexTest(schema, modules);
    await seedProject(t, PROJECT_A, tokenA);
    const response = await rpc(t, tokenA, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(response.status).toBe(202);
  });

  it("answers an unknown method with a JSON-RPC error", async () => {
    const t = convexTest(schema, modules);
    await seedProject(t, PROJECT_A, tokenA);
    const body = await (await rpc(t, tokenA, { jsonrpc: "2.0", id: 3, method: "resources/list" })).json();
    expect(body.error.code).toBe(-32601);
  });
});

describe("Internal MCP endpoint: tool filtering", () => {
  it("lists only the tools the Template declares, read-only", async () => {
    const t = convexTest(schema, modules);
    await seedProject(t, PROJECT_A, tokenA);
    const body = await (await rpc(t, tokenA, listTools)).json();
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["list_mission_types"]);
    expect(body.result.tools[0].annotations.readOnlyHint).toBe(true);
    expect(body.result.tools[0].inputSchema.type).toBe("object");
  });

  it("refuses a Template that declares no Internal MCP", async () => {
    const t = convexTest(schema, modules);
    const token = generateAgentToken(PROJECT_A, PLAIN);
    await seedProject(t, PROJECT_A, tokenA);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectAgents", { instanceId: PROJECT_A, templateId: PLAIN, status: "active", mcpServerKeys: [], config: { apiKey: token }, createdAt: 1, updatedAt: 1 });
    });
    expect((await rpc(t, token, listTools)).status).toBe(401);
  });

  it("a declared tool the catalog does not have is neither listed nor callable, and an undeclared one is refused", async () => {
    const t = convexTest(schema, modules);
    const token = generateAgentToken(PROJECT_A, NARROW);
    await seedProject(t, PROJECT_A, tokenA);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectAgents", { instanceId: PROJECT_A, templateId: NARROW, status: "active", mcpServerKeys: [], config: { apiKey: token }, createdAt: 1, updatedAt: 1 });
      const missionId = await ctx.db.insert("missions", { ownerId: "owner", instanceId: PROJECT_A, templateId: NARROW, type: "report", payload: {}, status: "doing", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("runs", { missionId, ownerId: "owner", instanceId: PROJECT_A, templateId: NARROW, agentName: "n", sessionKey: "n", status: "running", createdAt: 1, updatedAt: 1 });
    });
    expect((await (await rpc(t, token, listTools)).json()).result.tools).toEqual([]);
    expect((await (await rpc(t, token, callTool("list_mission_types"))).json()).error.code).toBe(-32602);
  });

  it("refuses a tool the Template did not declare, at call time", async () => {
    const t = convexTest(schema, modules);
    await seedProject(t, PROJECT_A, tokenA);
    const body = await (await rpc(t, tokenA, callTool("get_brand_core"))).json();
    expect(body.error.code).toBe(-32602);
    expect(body.result).toBeUndefined();
  });
});

describe("Internal MCP endpoint: list_mission_types", () => {
  it("returns the Project's activatable Mission types with their descriptions", async () => {
    const t = convexTest(schema, modules);
    await seedProject(t, PROJECT_A, tokenA);
    const body = await (await rpc(t, tokenA, callTool("list_mission_types"))).json();
    const types = JSON.parse(body.result.content[0].text);
    expect(types).toEqual([
      { templateId: WRITER, templateName: "Writer", type: "create_article", label: "Create an article", description: "Writes one article.", contentType: null, platforms: [], sourceRequired: false, creative: false },
      { templateId: WRITER, templateName: "Writer", type: "create_letter_video", label: "Create a letter video", description: "Writes articles.", contentType: null, platforms: [], sourceRequired: false, creative: false },
    ]);
  });

  it("leaves out the types an operator hid, and sees only its own Project", async () => {
    const t = convexTest(schema, modules);
    const tokenB = generateAgentToken(PROJECT_B, READER);
    await seedProject(t, PROJECT_A, tokenA);
    await seedProject(t, PROJECT_B, tokenB);
    const body = await (await rpc(t, tokenB, callTool("list_mission_types"))).json();
    expect(JSON.parse(body.result.content[0].text).map((entry: { type: string }) => entry.type)).toEqual(["create_article"]);
  });
});
