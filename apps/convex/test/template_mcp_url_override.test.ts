import { insertInstance } from "./instance_fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { RUNTIME_MCP_SERVERS_MERGE, RUNTIME_MCP_SERVERS_MERGE_RESULT } from "@opengroow/protocol";
import { api } from "../_generated/api";
import { enqueueInteractiveCommand, waitForRuntimeEvent } from "../runtime_commands_node";
import schema from "../schema";
import { getTemplateRegistry, setTemplateRegistryForTests } from "../template_registry";
import { resolveMcpServers } from "../project_agents/mcp_servers";
import { resolveTemplateMcpEndpoint } from "../mcp_endpoint";
import { fixtureTemplate, inMemoryRegistry } from "./helpers/template_registry.helpers";

// Self-host MCP URL override per installed Template (#654): one operator URL,
// derived into the runtime, Convex and public views of the server.

// Runtime round-trips (the MCP merge pushed to a running Agent) are stubbed.
vi.mock("../runtime_commands_node", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime_commands_node")>()),
  enqueueInteractiveCommand: vi.fn(),
  waitForRuntimeEvent: vi.fn(),
}));

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../instances.ts": () => import("../instances.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../project_agents_node.ts": () => import("../project_agents_node.js"),
  "../project_templates.ts": () => import("../project_templates.js"),
  "../template_mcp_overrides.ts": () => import("../template_mcp_overrides.js"),
};

const PROJECT = "inst-ovr";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|ovr" };
const OTHER = { name: "Other", email: "x@e.com", tokenIdentifier: "test|other-ovr" };

const withServer = (id: string, serverName = "article-mcp") =>
  fixtureTemplate(id, {
    mcpServers: [{ name: serverName, transport: "streamable-http", url: "https://seo.example.com/mcp" }],
  });

async function seed() {
  const t = convexTest(schema, modules);
  const now = new Date().toISOString();
  await t.run(async (ctx) => {
    await insertInstance(ctx, {
      jobId: "job-ovr",
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: now,
      updatedAt: now,
      openclawId: PROJECT,
      userId: OWNER.tokenIdentifier,
    });
  });
  return t;
}

const resolveOverridden = (t: ReturnType<typeof convexTest>, templateId: string) =>
  t.run(async (ctx) => (await getTemplateRegistry(ctx).resolve(PROJECT, templateId))!);

describe("Template MCP URL override", () => {
  const original = process.env.IS_SELF_HOST;
  beforeEach(() => {
    // Writes schedule a runtime push: it only runs where a test drains it.
    vi.useFakeTimers();
    process.env.IS_SELF_HOST = "1";
    setTemplateRegistryForTests(inMemoryRegistry([PROJECT], [withServer("a")]));
  });
  afterEach(() => {
    vi.useRealTimers();
    setTemplateRegistryForTests(undefined);
    if (original === undefined) delete process.env.IS_SELF_HOST;
    else process.env.IS_SELF_HOST = original;
  });

  it("reaches both the runtime MCP configuration and Convex's own calls, loopback made container-reachable", async () => {
    const t = await seed();
    await t.withIdentity(OWNER).mutation(api.template_mcp_overrides.set, {
      projectId: PROJECT,
      templateId: "a",
      serverName: "article-mcp",
      url: "http://localhost:4000/mcp",
    });
    const template = await resolveOverridden(t, "a");
    expect(resolveMcpServers(template).servers["article-mcp"]?.url).toBe("http://host.docker.internal:4000/mcp");
    expect(resolveTemplateMcpEndpoint(template, "article-mcp").mcpUrl).toBe("http://host.docker.internal:4000/mcp");
    // The public (browser-facing) view keeps the URL as the operator typed it.
    expect(template.manifest.mcpServers[0]?.publicBaseUrl).toBe("http://localhost:4000/mcp");
  });

  it("pushes a saved or cleared override to a running Agent's runtime MCP configuration", async () => {
    const t = await seed();
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: PROJECT,
        templateId: "a",
        workspaceKey: "ws-a",
        status: "active",
        mcpServerKeys: ["article-mcp"],
        config: { apiKey: "key-a" },
        createdAt: now,
        updatedAt: now,
      });
    });
    const enqueue = vi.mocked(enqueueInteractiveCommand);
    enqueue.mockReset().mockResolvedValue({ commandId: "cmd-merge" } as never);
    vi.mocked(waitForRuntimeEvent)
      .mockReset()
      .mockResolvedValue({
        status: 200,
        found: true,
        type: RUNTIME_MCP_SERVERS_MERGE_RESULT,
        payload: { ok: true, commandId: "cmd-merge", instanceId: PROJECT, data: { mergedKeys: ["article-mcp"] } },
      } as never);
    const pushedServers = () =>
      (enqueue.mock.calls.at(-1)?.[1] as { type: string; payload: { servers: Record<string, unknown> } }).payload
        .servers;

    const owner = t.withIdentity(OWNER);
    const key = { projectId: PROJECT, templateId: "a", serverName: "article-mcp" };
    await owner.mutation(api.template_mcp_overrides.set, { ...key, url: "http://localhost:4000/mcp" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]?.[1]).toMatchObject({ instanceId: PROJECT, type: RUNTIME_MCP_SERVERS_MERGE });
    expect(pushedServers()).toEqual({
      "article-mcp": {
        transport: "streamable-http",
        url: "http://host.docker.internal:4000/mcp",
        headers: { Authorization: "Bearer key-a" },
      },
    });

    await owner.mutation(api.template_mcp_overrides.clear, key);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(pushedServers()).toMatchObject({ "article-mcp": { url: "https://seo.example.com/mcp" } });
  });

  it("leaves a non-loopback override untouched in every view", async () => {
    const t = await seed();
    await t.withIdentity(OWNER).mutation(api.template_mcp_overrides.set, {
      projectId: PROJECT,
      templateId: "a",
      serverName: "article-mcp",
      url: "https://my-seo.internal/mcp",
    });
    const template = await resolveOverridden(t, "a");
    expect(resolveMcpServers(template).servers["article-mcp"]?.url).toBe("https://my-seo.internal/mcp");
    expect(resolveTemplateMcpEndpoint(template, "article-mcp").mcpUrl).toBe("https://my-seo.internal/mcp");
  });

  it("survives a Template update while the server name exists, and is ignored once it is gone", async () => {
    const t = await seed();
    await t.withIdentity(OWNER).mutation(api.template_mcp_overrides.set, {
      projectId: PROJECT,
      templateId: "a",
      serverName: "article-mcp",
      url: "https://my-seo.internal/mcp",
    });
    setTemplateRegistryForTests(inMemoryRegistry([PROJECT], [withServer("a")]));
    expect((await resolveOverridden(t, "a")).manifest.mcpServers[0]?.url).toBe("https://my-seo.internal/mcp");
    setTemplateRegistryForTests(inMemoryRegistry([PROJECT], [withServer("a", "renamed-mcp")]));
    expect((await resolveOverridden(t, "a")).manifest.mcpServers[0]?.url).toBe("https://seo.example.com/mcp");
  });

  it("is scoped to the installed Template, and can be cleared", async () => {
    const t = await seed();
    setTemplateRegistryForTests(inMemoryRegistry([PROJECT], [withServer("a"), withServer("b")]));
    const owner = t.withIdentity(OWNER);
    const key = { projectId: PROJECT, templateId: "a", serverName: "article-mcp" };
    await owner.mutation(api.template_mcp_overrides.set, { ...key, url: "https://my-seo.internal/mcp" });
    expect((await resolveOverridden(t, "b")).manifest.mcpServers[0]?.url).toBe("https://seo.example.com/mcp");
    expect(
      await owner.query(api.template_mcp_overrides.listForTemplate, { projectId: PROJECT, templateId: "a" }),
    ).toEqual([{ serverName: "article-mcp", url: "https://my-seo.internal/mcp" }]);
    await owner.mutation(api.template_mcp_overrides.clear, key);
    expect((await resolveOverridden(t, "a")).manifest.mcpServers[0]?.url).toBe("https://seo.example.com/mcp");
  });

  it("refuses unknown servers, invalid URLs and other users", async () => {
    const t = await seed();
    const args = { projectId: PROJECT, templateId: "a", serverName: "article-mcp", url: "https://x.example/mcp" };
    await expect(
      t.withIdentity(OWNER).mutation(api.template_mcp_overrides.set, { ...args, serverName: "nope" }),
    ).rejects.toThrow(/nope/);
    await expect(
      t.withIdentity(OWNER).mutation(api.template_mcp_overrides.set, { ...args, url: "ftp://x" }),
    ).rejects.toThrow(/http/);
    await expect(t.withIdentity(OTHER).mutation(api.template_mcp_overrides.set, args)).rejects.toThrow();
  });

  it("does not exist on the hosted deployment: refused, listed empty, and stored overrides ignored", async () => {
    const t = await seed();
    const args = { projectId: PROJECT, templateId: "a", serverName: "article-mcp", url: "https://my-seo.internal/mcp" };
    await t.withIdentity(OWNER).mutation(api.template_mcp_overrides.set, args);
    delete process.env.IS_SELF_HOST;
    await expect(t.withIdentity(OWNER).mutation(api.template_mcp_overrides.set, args)).rejects.toThrow(/self-host/i);
    expect(
      await t
        .withIdentity(OWNER)
        .query(api.template_mcp_overrides.listForTemplate, { projectId: PROJECT, templateId: "a" }),
    ).toEqual([]);
    expect((await resolveOverridden(t, "a")).manifest.mcpServers[0]?.url).toBe("https://seo.example.com/mcp");
  });
});
