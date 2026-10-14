import { insertInstance } from "./instance_fixture";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import {
  RUNTIME_AGENT_REGISTER_AND_CONFIGURE,
  RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
  RUNTIME_COMMAND_UNSUPPORTED,
  RUNTIME_OPENCLAW_EXEC,
  RUNTIME_OPENCLAW_EXEC_RESULT,
  RUNTIME_PLUGINS_INSTALL,
  RUNTIME_PLUGINS_INSTALL_RESULT,
  RUNTIME_WORKSPACE_LIST,
  RUNTIME_WORKSPACE_LIST_RESULT,
  RUNTIME_WORKSPACE_CREATE_RESULT,
  RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
  RUNTIME_WORKSPACE_FILE_DELETE_BATCH_RESULT,
  RUNTIME_MCP_SERVERS_MERGE_RESULT,
  RUNTIME_MCP_SERVERS_REMOVE,
  RUNTIME_MCP_SERVERS_REMOVE_RESULT,
  RUNTIME_AGENT_CREDENTIAL_SET_RESULT,
} from "@opengroow/protocol";
import { officialFixtureTemplate, fixtureTemplate, installTemplateRegistry } from "./helpers/template_registry.helpers";

vi.mock("../runtime_commands_node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../runtime_commands_node")>();
  const { internal: generatedInternal } = await import("../_generated/api");
  return {
    ...actual,
    enqueueInteractiveCommand: (
      ctx: Parameters<typeof actual.enqueueInteractiveCommand>[0],
      args: Parameters<typeof actual.enqueueInteractiveCommand>[1],
    ) => ctx.runMutation(generatedInternal.commands.enqueueInteractive, args),
    waitForRuntimeEvent: vi.fn(),
  };
});

// Pass modules explicitly to avoid import.meta.glob (not available in Node/edge-runtime).
// Must include a "_generated" path so convex-test can locate the module root.
const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../commands.ts": () => import("../commands.js"),
  "../commands_node.ts": () => import("../commands_node.js"),
  "../connect_tickets.ts": () => import("../connect_tickets.js"),
  "../connect_tickets_node.ts": () => import("../connect_tickets_node.js"),
  "../events.ts": () => import("../events.js"),
  "../health.ts": () => import("../health.js"),
  "../http.ts": () => import("../http.js"),
  "../instances.ts": () => import("../instances.js"),
  "../instances_node.ts": () => import("../instances_node.js"),
  "../missions.ts": () => import("../missions.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../project_agents_node.ts": () => import("../project_agents_node.js"),
  "../runs.ts": () => import("../runs.js"),
  "../runtime_commands_node.ts": () => import("../runtime_commands_node.js"),
};

async function seedRun(
  t: ReturnType<typeof convexTest>,
  opts: {
    instanceId: string;
    templateId: string;
    status: "pending" | "dispatching" | "running" | "completed" | "failed";
  },
) {
  await t.run(async (ctx) => {
    const now = Date.now();
    const missionId = await ctx.db.insert("missions", {
      ownerId: "owner-1",
      instanceId: opts.instanceId,
      templateId: opts.templateId,
      type: "create_article",
      payload: {},
      status: "todo",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("runs", {
      missionId,
      ownerId: "owner-1",
      instanceId: opts.instanceId,
      templateId: opts.templateId,
      agentName: opts.templateId,
      sessionKey: `key-${now}`,
      status: opts.status,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function getWaitForRuntimeEvent() {
  const mod = await import("../runtime_commands_node");
  return mod.waitForRuntimeEvent as ReturnType<typeof vi.fn>;
}

const INSTANCE_ID = "openclaw-instance-abc123";
const OTHER_INSTANCE_ID = "openclaw-instance-other";
const TEMPLATE_ID = "@opengroow/seo";

// Templates resolve through the registry: seed an in-memory one (a Project is
// identified by its Instance id) with the Templates these suites activate.
let restoreRegistry: () => void;
beforeEach(async () => {
  restoreRegistry = installTemplateRegistry(
    [INSTANCE_ID, OTHER_INSTANCE_ID],
    await Promise.all(["@opengroow/seo", "@opengroow/hello", "@opengroow/engagement"].map((id) => officialFixtureTemplate(id))),
  );
});
afterEach(() => {
  restoreRegistry();
});
const WORKSPACE_ABSOLUTE_PATH = "/home/node/.openclaw/workspace-ws-generated";

const SEO_MCP_KEYS = ["article-mcp"];
// article-mcp now owns Project config end-to-end (issue #320, ADR-034) —
// apiKey is the Template's sole requirement.
const DEFAULT_SEO_USER_CONFIG = {
  apiKey: "key-test",
} as const;

// MCP tools/call JSON-RPC envelope for a successful `get_project_status`
// response reporting the Project as fully configured — the default shape
// `beforeEach` stubs `fetch` with, since activating "seo" now calls the
// Config Completeness status-check instead of POSTing /projects.
function configuredStatusCheckResponse(dashboardUrl = "https://article-mcp.example/dashboard/proj-default") {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: JSON_RESPONSE_HEADERS,
    json: async () => ({
      result: { content: [{ type: "text", text: JSON.stringify({ configured: true, dashboardUrl }) }] },
    }),
  };
}

function notConfiguredStatusCheckResponse(message?: string, dashboardUrl = "https://article-mcp.example/dashboard/proj-default") {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: JSON_RESPONSE_HEADERS,
    json: async () => ({
      result: { content: [{ type: "text", text: JSON.stringify({ configured: false, message, dashboardUrl }) }] },
    }),
  };
}

const TEST_USER = { name: "Test User", email: "test@example.com", tokenIdentifier: "test|user-1" };
const OTHER_USER = { name: "Other User", email: "other@example.com", tokenIdentifier: "test|user-2" };
const SUBJECT_USER = {
  name: "Subject User",
  email: "subject@example.com",
  tokenIdentifier: "test|token-subject",
  subject: "subject-user-1",
};

async function seedInstance(
  t: ReturnType<typeof convexTest>,
  userId: string | null = TEST_USER.tokenIdentifier,
  jobId = `job-${INSTANCE_ID}`,
) {
  const now = new Date().toISOString();
  await t.run(async (ctx) => {
    const instance = {
      jobId,
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: now,
      openclawId: INSTANCE_ID,
      updatedAt: now,
    } as const;
    await insertInstance(ctx, userId === null ? instance : { ...instance, userId });
  });
}

const OPENCLAW_DEFAULT_FILES = ["SOUL.md", "USER.md", "IDENTITY.md", "HEARTBEAT.md", "BOOT.md", "BOOTSTRAP.md", "MEMORY.md"];
const JSON_RESPONSE_HEADERS = { get: (key: string) => key === "content-type" ? "application/json" : null };

function batchDeleteResult(workspaceKey: string, extraPaths: readonly string[] = []) {
  return {
    status: 200 as const, found: true, type: RUNTIME_WORKSPACE_FILE_DELETE_BATCH_RESULT,
    payload: {
      ok: true, commandId: "cmd-del-batch", instanceId: INSTANCE_ID,
      data: { workspaceKey, results: [...OPENCLAW_DEFAULT_FILES, ...extraPaths].map((filePath) => ({ filePath, ok: true, deleted: true })) },
    },
  };
}

// `extraPaths`: files the request also deletes (e.g. a hidden Mission type's
// instruction file), so the mocked result mirrors the real batch payload.
function addFileDeleteMocks(mock: ReturnType<typeof vi.fn>, workspaceKey: string, extraPaths: readonly string[] = []) {
  mock.mockResolvedValueOnce(batchDeleteResult(workspaceKey, extraPaths));
  return mock;
}

function fileWriteResult(workspaceKey: string, filePath: string, ok = true, error?: string) {
  return {
    status: ok ? 200 as const : 500 as const,
    found: true,
    type: RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
    payload: ok
      ? { ok: true, commandId: `cmd-write-${filePath}`, instanceId: INSTANCE_ID, data: { workspaceKey, filePath } }
      : { ok: false, commandId: `cmd-write-${filePath}`, instanceId: INSTANCE_ID, error },
  };
}

function workspaceListResult(workspaceKey: string, title = "SEO") {
  return {
    status: 200 as const,
    found: true,
    type: RUNTIME_WORKSPACE_LIST_RESULT,
    payload: {
      ok: true,
      commandId: "cmd-list-workspaces",
      instanceId: INSTANCE_ID,
      data: {
        workspaces: [{
          workspaceKey,
          title,
          absolutePath: `/home/node/.openclaw/workspace-${workspaceKey}`,
          isActive: true,
          kind: "project",
          availableFiles: [],
        }],
      },
    },
  };
}

function agentCredentialResult(agentId = "opengroow--engagement") {
  return {
    status: 200 as const,
    found: true,
    type: RUNTIME_AGENT_CREDENTIAL_SET_RESULT,
    payload: {
      ok: true,
      commandId: "cmd-agent-credential",
      instanceId: INSTANCE_ID,
      data: { agentId },
    },
  };
}

// The report-sync plugin social-engagement ships (#661): `changed` says whether
// the Instance had to write it, i.e. whether the Gateway must restart.
function pluginsInstallResult(changed: boolean, ids = ["engagement-report-sync"]) {
  return {
    status: 200 as const,
    found: true,
    type: RUNTIME_PLUGINS_INSTALL_RESULT,
    payload: {
      ok: true,
      commandId: "cmd-plugins-install",
      instanceId: INSTANCE_ID,
      data: { plugins: ids.map((id) => ({ id, changed })) },
    },
  };
}

function gatewayRestartResult() {
  return {
    status: 200 as const,
    found: true,
    type: RUNTIME_OPENCLAW_EXEC_RESULT,
    payload: { ok: true, commandId: "cmd-gateway-restart", instanceId: INSTANCE_ID, data: { output: "scheduled", success: true, exitCode: 0 } },
  };
}

function addSeoMissionInstructionWriteMocks(
  mock: ReturnType<typeof vi.fn>,
  workspaceKey: string,
) {
  mock
    .mockResolvedValueOnce(fileWriteResult(workspaceKey, "create_article.md"))
    .mockResolvedValueOnce(fileWriteResult(workspaceKey, "internal_linking.md"));
  return mock;
}

type SeededProjectAgentSkill = {
  source: "clawhub";
  spec: string;
  origin: "template" | "user";
  status: "installed" | "error";
  updatedAt: number;
  version?: string;
  errorMessage?: string;
};

async function seedProjectAgent(
  t: ReturnType<typeof convexTest>,
  opts: {
    instanceId?: string;
    templateId?: string;
    status?: "activating" | "active" | "inactive" | "error";
    workspaceKey?: string;
    mcpServerKeys?: string[];
    config?: Record<string, unknown>;
    skills?: SeededProjectAgentSkill[];
    hiddenMissionTypes?: string[];
  } = {},
) {
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("projectAgents", {
      hiddenMissionTypes: opts.hiddenMissionTypes,
      instanceId: opts.instanceId ?? INSTANCE_ID,
      templateId: opts.templateId ?? TEMPLATE_ID,
      status: opts.status ?? "active",
      workspaceKey: opts.workspaceKey,
      mcpServerKeys: opts.mcpServerKeys ?? [],
      config: opts.config,
      skills: opts.skills,
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("activateProjectAgent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("ACTIVATION_BROKER_TIMEOUT_MS", "5000");
    // Default fetch mock for the seo/video statusCheck MCP tool call
    // (issue #320, ADR-034): reports the Project as fully configured.
    // Tests that need specific behaviour override this stub inline.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(configuredStatusCheckResponse()));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("fresh activation produces a projectAgents record with status: active, workspaceKey, and mcpServerKeys", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        payload: { ok: true, commandId: "cmd-1", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-generated", label: TEMPLATE_ID, absolutePath: WORKSPACE_ABSOLUTE_PATH } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_MCP_SERVERS_MERGE_RESULT,
        payload: { ok: true, commandId: "cmd-2", instanceId: INSTANCE_ID, data: { mergedKeys: SEO_MCP_KEYS } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-agents-add", instanceId: INSTANCE_ID, data: { agentId: TEMPLATE_ID, registered: true, configured: false } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-generated");
    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
        payload: { ok: true, commandId: "cmd-agents-md", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-generated", filePath: "AGENTS.md" } },
      });
    addSeoMissionInstructionWriteMocks(waitForRuntimeEvent, "ws-generated");

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: DEFAULT_SEO_USER_CONFIG,
    });

    expect(result.status).toBe("active");
    if (result.status === "active") {
      expect(result.workspaceKey).toBeTypeOf("string");
      expect(result.workspaceKey.length).toBeGreaterThan(0);
      expect(result.mcpServerKeys).toEqual(SEO_MCP_KEYS);
    }

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    expect(record).not.toBeNull();
    expect(record?.status).toBe("active");
    expect(record?.workspaceKey).toBeTypeOf("string");
    expect(record?.openclawAgentName).toBe("opengroow--seo");
    expect(record?.mcpServerKeys).toEqual(SEO_MCP_KEYS);
    expect(waitForRuntimeEvent).toHaveBeenCalledTimes(7);
  });

  it("cold activation registers a missing native OpenClaw agent in the created workspace", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        payload: { ok: true, commandId: "cmd-create", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-generated", label: TEMPLATE_ID, absolutePath: "/home/node/.openclaw/workspace-ws-generated" } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_MCP_SERVERS_MERGE_RESULT,
        payload: { ok: true, commandId: "cmd-merge", instanceId: INSTANCE_ID, data: { mergedKeys: SEO_MCP_KEYS } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-agents-add", instanceId: INSTANCE_ID, data: { agentId: TEMPLATE_ID, registered: true, configured: false } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-generated");
    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
        payload: { ok: true, commandId: "cmd-agents-md", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-generated", filePath: "AGENTS.md" } },
      });
    addSeoMissionInstructionWriteMocks(waitForRuntimeEvent, "ws-generated");

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: DEFAULT_SEO_USER_CONFIG,
    });

    expect(result.status).toBe("active");

    const commands = await t.run(async (ctx) => {
      return await ctx.db.query("commands").collect();
    });
    expect(commands.map((command) => command.type)).toEqual([
      "runtime.workspace.create",
      "runtime.mcp.servers.merge",
      RUNTIME_AGENT_REGISTER_AND_CONFIGURE,
      "runtime.workspace.file.delete_batch",
      "runtime.workspace.file.write",
      "runtime.workspace.file.write",
      "runtime.workspace.file.write",
    ]);
    // `agents list` is part of the compound command now, not its own
    // round-trip: the list → add → config sequence has to be atomic.
    expect(commands[2].payload).toMatchObject({
      agentId: "opengroow--seo",
      listCommandText: "openclaw agents list --json",
      registerCommandText: "openclaw agents add opengroow--seo --workspace /home/node/.openclaw/workspace-ws-generated --non-interactive --json",
    });
    // A Template without an OpenClaw profile is registered with OpenClaw defaults.
    expect((commands[2].payload as { configureCommandText?: string }).configureCommandText).toBeUndefined();

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    expect(record?.openclawAgentName).toBe("opengroow--seo");
  });

  it("warm activation falls back to workspace.list when registering a missing native agent", async () => {
    // Recovery from a prior cold activation that persisted workspaceKey but
    // crashed before native agents add. Here `agents list` returns empty and
    // CREATE returns no absolutePath, so we fall back to workspace.list.
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        status: "active",
        workspaceKey: "ws-orphan",
        mcpServerKeys: [],
        createdAt: now,
        updatedAt: now,
      });
    });

    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        // No absolutePath → triggers fallback to workspace.list
        payload: { ok: true, commandId: "cmd-create", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-orphan", label: TEMPLATE_ID } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_MCP_SERVERS_MERGE_RESULT,
        payload: { ok: true, commandId: "cmd-merge", instanceId: INSTANCE_ID, data: { mergedKeys: SEO_MCP_KEYS } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_LIST_RESULT,
        payload: { ok: true, commandId: "cmd-list-workspaces", instanceId: INSTANCE_ID, data: { workspaces: [{ workspaceKey: "ws-orphan", title: "SEO", absolutePath: "/home/node/.openclaw/workspace-ws-orphan", isActive: true, kind: "project", availableFiles: [] }] } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-agents-add", instanceId: INSTANCE_ID, data: { agentId: TEMPLATE_ID, registered: true, configured: false } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-orphan");
    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
        payload: { ok: true, commandId: "cmd-agents-md", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-orphan", filePath: "AGENTS.md" } },
      });
    addSeoMissionInstructionWriteMocks(waitForRuntimeEvent, "ws-orphan");

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: DEFAULT_SEO_USER_CONFIG,
    });

    expect(result.status).toBe("active");
    const commands = await t.run(async (ctx) => {
      return await ctx.db.query("commands").collect();
    });
    expect(commands.map((command) => command.type)).toEqual([
      "runtime.workspace.create",
      "runtime.mcp.servers.merge",
      RUNTIME_WORKSPACE_LIST,
      RUNTIME_AGENT_REGISTER_AND_CONFIGURE,
      "runtime.workspace.file.delete_batch",
      "runtime.workspace.file.write",
      "runtime.workspace.file.write",
      "runtime.workspace.file.write",
    ]);
    expect(commands[3].payload).toMatchObject({
      agentId: "opengroow--seo",
      registerCommandText: "openclaw agents add opengroow--seo --workspace /home/node/.openclaw/workspace-ws-orphan --non-interactive --json",
    });
  });

  it("falls back to the individual commands when the register/configure compound is unsupported", async () => {
    // Rollout window (issue #447): a Runtime Worker older than this Convex
    // deployment drops the unknown command at wire validation and answers
    // nothing, so the wait times out. Activation must still succeed.
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        payload: { ok: true, commandId: "cmd-create", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-legacy", label: TEMPLATE_ID, absolutePath: "/home/node/.openclaw/workspace-ws-legacy" } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_MCP_SERVERS_MERGE_RESULT,
        payload: { ok: true, commandId: "cmd-merge", instanceId: INSTANCE_ID, data: { mergedKeys: SEO_MCP_KEYS } },
      })
      .mockResolvedValueOnce({ status: 504, found: false })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_OPENCLAW_EXEC_RESULT,
        payload: { ok: true, commandId: "cmd-agents-list", instanceId: INSTANCE_ID, data: { output: JSON.stringify([]) } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_OPENCLAW_EXEC_RESULT,
        payload: { ok: true, commandId: "cmd-agents-add", instanceId: INSTANCE_ID, data: { output: JSON.stringify({ agentId: TEMPLATE_ID }) } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-legacy");
    waitForRuntimeEvent
      .mockResolvedValueOnce(fileWriteResult("ws-legacy", "AGENTS.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-legacy", "create_article.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-legacy", "internal_linking.md"));

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: DEFAULT_SEO_USER_CONFIG,
    });

    expect(result.status).toBe("active");
    const commands = await t.run(async (ctx) => ctx.db.query("commands").collect());
    expect(commands.map((command) => command.type)).toEqual([
      "runtime.workspace.create",
      "runtime.mcp.servers.merge",
      RUNTIME_AGENT_REGISTER_AND_CONFIGURE,
      RUNTIME_OPENCLAW_EXEC,
      RUNTIME_OPENCLAW_EXEC,
      "runtime.workspace.file.delete_batch",
      "runtime.workspace.file.write",
      "runtime.workspace.file.write",
      "runtime.workspace.file.write",
    ]);
    expect(commands[3].payload).toEqual({ commandText: "openclaw agents list --json" });
    expect(commands[4].payload).toEqual({
      commandText: "openclaw agents add opengroow--seo --workspace /home/node/.openclaw/workspace-ws-legacy --non-interactive --json",
    });
  });

  it("falls back when a newer Runtime Worker answers runtime.command.unsupported", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        payload: { ok: true, commandId: "cmd-create", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-unsupported", label: TEMPLATE_ID, absolutePath: "/home/node/.openclaw/workspace-ws-unsupported" } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_MCP_SERVERS_MERGE_RESULT,
        payload: { ok: true, commandId: "cmd-merge", instanceId: INSTANCE_ID, data: { mergedKeys: SEO_MCP_KEYS } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_COMMAND_UNSUPPORTED,
        payload: { ok: false, commandId: "cmd-compound", instanceId: INSTANCE_ID, error: "Unsupported command type: runtime.agent.register_and_configure" },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_OPENCLAW_EXEC_RESULT,
        payload: { ok: true, commandId: "cmd-agents-list", instanceId: INSTANCE_ID, data: { output: JSON.stringify([{ id: "opengroow--seo", workspace: "/home/node/.openclaw/workspace-ws-unsupported" }]) } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-unsupported");
    waitForRuntimeEvent
      .mockResolvedValueOnce(fileWriteResult("ws-unsupported", "AGENTS.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-unsupported", "create_article.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-unsupported", "internal_linking.md"));

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: DEFAULT_SEO_USER_CONFIG,
    });

    expect(result.status).toBe("active");
    // The fallback re-reads the live state, so an already-registered agent
    // still short-circuits `agents add`.
    const commands = await t.run(async (ctx) => ctx.db.query("commands").collect());
    expect(commands.filter((c) => c.type === RUNTIME_OPENCLAW_EXEC)).toHaveLength(1);
  });

  it("cold activation skips native agent add when OpenClaw already lists the template in the same workspace", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        payload: { ok: true, commandId: "cmd-create", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-generated", label: TEMPLATE_ID, absolutePath: WORKSPACE_ABSOLUTE_PATH } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_MCP_SERVERS_MERGE_RESULT,
        payload: { ok: true, commandId: "cmd-merge", instanceId: INSTANCE_ID, data: { mergedKeys: SEO_MCP_KEYS } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-register", instanceId: INSTANCE_ID, data: { agentId: TEMPLATE_ID, alreadyRegistered: true, registered: true, configured: false, workspace: WORKSPACE_ABSOLUTE_PATH } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-generated");
    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
        payload: { ok: true, commandId: "cmd-agents", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-generated", filePath: "AGENTS.md" } },
      });
    addSeoMissionInstructionWriteMocks(waitForRuntimeEvent, "ws-generated");

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: DEFAULT_SEO_USER_CONFIG,
    });

    expect(result.status).toBe("active");
    const commands = await t.run(async (ctx) => {
      return await ctx.db.query("commands").collect();
    });
    expect(commands.map((command) => command.type)).toEqual([
      "runtime.workspace.create",
      "runtime.mcp.servers.merge",
      RUNTIME_AGENT_REGISTER_AND_CONFIGURE,
      "runtime.workspace.file.delete_batch",
      "runtime.workspace.file.write",
      "runtime.workspace.file.write",
      "runtime.workspace.file.write",
    ]);
    expect(commands[2].payload).toMatchObject({
      agentId: "opengroow--seo",
      listCommandText: "openclaw agents list --json",
    });
  });

  it("cold activation warns and continues when OpenClaw lists the template in a different workspace", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        payload: { ok: true, commandId: "cmd-create", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-generated", label: TEMPLATE_ID, absolutePath: WORKSPACE_ABSOLUTE_PATH } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_MCP_SERVERS_MERGE_RESULT,
        payload: { ok: true, commandId: "cmd-merge", instanceId: INSTANCE_ID, data: { mergedKeys: SEO_MCP_KEYS } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-register", instanceId: INSTANCE_ID, data: { agentId: TEMPLATE_ID, alreadyRegistered: true, registered: true, configured: false, workspace: "/different/workspace" } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-generated");
    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
        payload: { ok: true, commandId: "cmd-agents", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-generated", filePath: "AGENTS.md" } },
      });
    addSeoMissionInstructionWriteMocks(waitForRuntimeEvent, "ws-generated");

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: DEFAULT_SEO_USER_CONFIG,
    });

    expect(result.status).toBe("active");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("already registered"));
    const commands = await t.run(async (ctx) => {
      return await ctx.db.query("commands").collect();
    });
    expect(
      commands.filter((command) => command.type === RUNTIME_AGENT_REGISTER_AND_CONFIGURE),
    ).toHaveLength(1);
    warn.mockRestore();
  });

  it("activation fails fast when OpenClaw agents list returns a non-array root", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        payload: { ok: true, commandId: "cmd-create", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-generated", label: TEMPLATE_ID, absolutePath: WORKSPACE_ABSOLUTE_PATH } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_MCP_SERVERS_MERGE_RESULT,
        payload: { ok: true, commandId: "cmd-merge", instanceId: INSTANCE_ID, data: { mergedKeys: SEO_MCP_KEYS } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: false, commandId: "cmd-register", instanceId: INSTANCE_ID, error: "OpenClaw agents list returned invalid JSON: expected a top-level array", data: { agentId: TEMPLATE_ID, alreadyRegistered: false, registered: false, configured: false } },
      });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: DEFAULT_SEO_USER_CONFIG,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.errorMessage).toContain("invalid JSON");
    }
  });

  it("returns Forbidden when activating an agent on another user's instance", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t, TEST_USER.tokenIdentifier);

    const result = await t.withIdentity(OTHER_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });

    expect(result).toEqual({ status: "error", errorMessage: "Forbidden" });
    expect(waitForRuntimeEvent).not.toHaveBeenCalled();
  });

  it("allows activation when instance ownership matches the identity subject", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t, SUBJECT_USER.subject);

    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        payload: { ok: true, commandId: "cmd-subject-1", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-subject", label: TEMPLATE_ID, absolutePath: "/home/node/.openclaw/workspace-ws-subject" } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_MCP_SERVERS_MERGE_RESULT,
        payload: { ok: true, commandId: "cmd-subject-4", instanceId: INSTANCE_ID, data: { mergedKeys: SEO_MCP_KEYS } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-subject-agents-add", instanceId: INSTANCE_ID, data: { agentId: TEMPLATE_ID, registered: true, configured: false } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-subject");
    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
        payload: { ok: true, commandId: "cmd-subject-3", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-subject", filePath: "AGENTS.md" } },
      });
    addSeoMissionInstructionWriteMocks(waitForRuntimeEvent, "ws-subject");

    const result = await t.withIdentity(SUBJECT_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: DEFAULT_SEO_USER_CONFIG,
    });

    expect(result.status).toBe("active");
    expect(waitForRuntimeEvent).toHaveBeenCalledTimes(7);
  });

  it("allows activation on a unique unowned local instance", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t, null);

    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        payload: { ok: true, commandId: "cmd-local-1", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-local", label: TEMPLATE_ID, absolutePath: "/home/node/.openclaw/workspace-ws-local" } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_MCP_SERVERS_MERGE_RESULT,
        payload: { ok: true, commandId: "cmd-local-4", instanceId: INSTANCE_ID, data: { mergedKeys: SEO_MCP_KEYS } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-local-agents-add", instanceId: INSTANCE_ID, data: { agentId: TEMPLATE_ID, registered: true, configured: false } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-local");
    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
        payload: { ok: true, commandId: "cmd-local-3", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-local", filePath: "AGENTS.md" } },
      });
    addSeoMissionInstructionWriteMocks(waitForRuntimeEvent, "ws-local");

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: DEFAULT_SEO_USER_CONFIG,
    });

    expect(result.status).toBe("active");
    expect(waitForRuntimeEvent).toHaveBeenCalledTimes(7);
  });

  it("returns Forbidden when activating an agent with an ambiguous instance owner", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t, TEST_USER.tokenIdentifier, `job-${INSTANCE_ID}-a`);
    await seedInstance(t, OTHER_USER.tokenIdentifier, `job-${INSTANCE_ID}-b`);

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: DEFAULT_SEO_USER_CONFIG,
    });

    expect(result).toEqual({ status: "error", errorMessage: "Forbidden" });
    expect(waitForRuntimeEvent).not.toHaveBeenCalled();
  });

  it("rejects an unknown template before dispatching runtime commands", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: "missing-template",
    });

    expect(result).toEqual({
      status: "error",
      errorMessage: "Template not found: missing-template",
    });
    expect(waitForRuntimeEvent).not.toHaveBeenCalled();
  });

  it("resolves MCP server config from the template manifest (not from env var)", async () => {
    // MCP config now lives in the template manifest; no env var is needed.
    // Verify that activation succeeds even when MCP_SERVERS_CONFIG is absent.
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        payload: { ok: true, commandId: "cmd-1", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-manifest", label: TEMPLATE_ID, absolutePath: WORKSPACE_ABSOLUTE_PATH } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_MCP_SERVERS_MERGE_RESULT,
        payload: { ok: true, commandId: "cmd-2", instanceId: INSTANCE_ID, data: { mergedKeys: SEO_MCP_KEYS } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-4", instanceId: INSTANCE_ID, data: { agentId: TEMPLATE_ID, registered: true, configured: false } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-manifest");
    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
        payload: { ok: true, commandId: "cmd-6", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-manifest", filePath: "AGENTS.md" } },
      });
    addSeoMissionInstructionWriteMocks(waitForRuntimeEvent, "ws-manifest");

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: DEFAULT_SEO_USER_CONFIG,
    });

    expect(result.status).toBe("active");

    // Verify the merge payload uses the URL from the manifest
    const commands = await t.run(async (ctx) => ctx.db.query("commands").collect());
    const mergeCommand = commands.find((c) => c.type === "runtime.mcp.servers.merge");
    expect(mergeCommand).toBeDefined();
    const servers = mergeCommand!.payload.servers as Record<string, Record<string, unknown>>;
    expect(servers["article-mcp"]).toBeDefined();
    // activationUrl is stripped; url from manifest is present
    expect(servers["article-mcp"]?.url).toBe("http://host.docker.internal:4000/mcp");
    expect(servers["article-mcp"]).not.toHaveProperty("activationUrl");
  });

  it("activates social-engagement: feed-mcp is merged with the BYOK apiKey Authorization header (issue #455)", async () => {
    // Prior to issue #455, social-engagement declared mcpServers: [] and this
    // test covered the "no merge call for a Template with no MCP servers"
    // regression directly (now covered instead by the "hello template
    // activation" test below, which still has an empty mcpServers list).
    // Deep enrichment gives social-engagement its first MCP server
    // (feed-mcp) and a required BYOK `apiKey` — this test now covers THAT:
    // the merge command is enqueued and carries the Project's own apiKey as
    // a Bearer Authorization header, same pattern as article-mcp.
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        payload: { ok: true, commandId: "cmd-1", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-social", label: "@opengroow/engagement", absolutePath: WORKSPACE_ABSOLUTE_PATH } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_MCP_SERVERS_MERGE_RESULT,
        payload: { ok: true, commandId: "cmd-2", instanceId: INSTANCE_ID, data: { mergedKeys: ["feed-mcp"] } },
      })
      // registerNativeOpenClawAgent: one compound command that runs
      // `openclaw agents add` then the tool deny-list `config set`.
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-3", instanceId: INSTANCE_ID, data: { agentId: "opengroow--engagement", registered: true, configured: true } },
      })
      .mockResolvedValueOnce(agentCredentialResult());
    addFileDeleteMocks(waitForRuntimeEvent, "ws-social");
    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
        payload: { ok: true, commandId: "cmd-agents", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-social", filePath: "AGENTS.md" } },
      })
      .mockResolvedValueOnce(fileWriteResult("ws-social", "engage.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-social", "sources/video-post.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-social", "sources/image-post.md"))
      // social-engagement declares humanize as a required Template skill (issue #222).
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_OPENCLAW_EXEC_RESULT,
        payload: { ok: true, commandId: "cmd-skill-install", instanceId: INSTANCE_ID, data: { output: "" } },
      })
      .mockResolvedValueOnce(pluginsInstallResult(false));

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: "@opengroow/engagement",
      userConfig: {
        apiKey: "key-social-test",
        accountHandleInstagram: "@testaccount",
        accountHandleTiktok: "@testaccount.tt",
        accountBio: "Street photography account based in Paris.",
        likeWhen: "Street photography, urban architecture, B&W photography",
        classifierApiKey: "agent-key-social-test",
      },
    });

    expect(result.status).toBe("active");
    if (result.status === "active") {
      expect(result.mcpServerKeys).toEqual(["feed-mcp"]);
    }

    // Verify the MCP merge command was enqueued for feed-mcp with the
    // Project's apiKey as a Bearer Authorization header.
    const commands = await t.run(async (ctx) => ctx.db.query("commands").collect());
    const mergeCommand = commands.find((c) => c.type === "runtime.mcp.servers.merge");
    expect(mergeCommand).toBeDefined();
    const servers = mergeCommand!.payload.servers as Record<string, Record<string, unknown>>;
    const headers = servers["feed-mcp"]?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer key-social-test");

    // Tool restrictions and exec node come from the Template's OpenClaw profile.
    const registerCommand = commands.find((c) => c.type === RUNTIME_AGENT_REGISTER_AND_CONFIGURE);
    expect((registerCommand?.payload as { configureCommandText?: string }).configureCommandText).toBe(
      `openclaw config set agents.entries.opengroow--engagement.tools '{"deny":["sessions_spawn","sessions_yield"],"exec":{"host":"node","node":"My Computer"}}' --json --merge`,
    );

    const agentCredentialCommand = commands.find((c) => c.type === "runtime.agent-credential.set");
    expect(agentCredentialCommand?.payload).toEqual({
      agentId: "opengroow--engagement",
      apiKey: "agent-key-social-test",
    });

    // Verify the required Template skill was installed and persisted.
    const skillInstallCommand = commands.find(
      (c) => c.type === RUNTIME_OPENCLAW_EXEC && (c.payload as { commandText?: string }).commandText?.includes("clawhub install"),
    );
    expect(skillInstallCommand?.payload).toEqual({
      commandText: `clawhub install humanize --workdir ${WORKSPACE_ABSOLUTE_PATH}`,
    });

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: "@opengroow/engagement",
    });
    expect(record?.skills).toEqual([
      expect.objectContaining({
        source: "clawhub",
        spec: "humanize",
        origin: "template",
        status: "installed",
      }),
    ]);
  });

  it("rejects activation when a required manifest field is missing before writing activating state", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: {
        domain: "example.com",
        language: "en",
        country: "US",
      },
    });

    expect(result).toEqual({
      status: "error",
      errorMessage: "Missing required field: apiKey",
    });
    expect(waitForRuntimeEvent).not.toHaveBeenCalled();

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    expect(record).toBeNull();
  });

  it("rejects activation when a required manifest field is blank before writing activating state", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: {
        ...DEFAULT_SEO_USER_CONFIG,
        apiKey: "   ",
      },
    });

    expect(result).toEqual({
      status: "error",
      errorMessage: "Missing required field: apiKey",
    });
    expect(waitForRuntimeEvent).not.toHaveBeenCalled();

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    expect(record).toBeNull();
  });

  it("re-activation skips workspace creation and file writes when workspaceKey already exists", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    // Seed an existing projectAgents record with a workspaceKey
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        status: "active",
        workspaceKey: "existing-workspace-key",
        mcpServerKeys: [],
        createdAt: now,
        updatedAt: now,
      });
    });

    // Agents list shows the template is already registered natively, so no agents add.
    // Workspace files are always rewritten.
    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        payload: { ok: true, commandId: "cmd-create", instanceId: INSTANCE_ID, data: { workspaceKey: "existing-workspace-key", label: TEMPLATE_ID, absolutePath: "/home/node/.openclaw/workspace-existing-workspace-key" } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_MCP_SERVERS_MERGE_RESULT,
        payload: { ok: true, commandId: "cmd-5", instanceId: INSTANCE_ID, data: { mergedKeys: SEO_MCP_KEYS } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-register", instanceId: INSTANCE_ID, data: { agentId: TEMPLATE_ID, alreadyRegistered: true, registered: true, configured: false, workspace: "/home/node/.openclaw/workspace-existing-workspace-key" } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "existing-workspace-key");
    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
        payload: { ok: true, commandId: "cmd-agents-md", instanceId: INSTANCE_ID, data: { workspaceKey: "existing-workspace-key", filePath: "AGENTS.md" } },
      });
    addSeoMissionInstructionWriteMocks(waitForRuntimeEvent, "existing-workspace-key");

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: DEFAULT_SEO_USER_CONFIG,
    });

    expect(result.status).toBe("active");
    if (result.status === "active") {
      expect(result.workspaceKey).toBe("existing-workspace-key");
    }
    expect(waitForRuntimeEvent).toHaveBeenCalledTimes(7);

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    expect(record?.status).toBe("active");
    expect(record?.workspaceKey).toBe("existing-workspace-key");
    expect(record?.mcpServerKeys).toEqual(SEO_MCP_KEYS);
  });

  it("transitions to status: error with errorMessage when workspace create fails", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    // Workspace create fails
    waitForRuntimeEvent.mockResolvedValueOnce({
      status: 500,
      found: false,
    });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: DEFAULT_SEO_USER_CONFIG,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.errorMessage).toBeTypeOf("string");
      expect(result.errorMessage.length).toBeGreaterThan(0);
    }

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    expect(record?.status).toBe("error");
    expect(record?.errorMessage).toBeTypeOf("string");
  });

  // Config Completeness (issue #320, ADR-034): seo/video no longer POST
  // /projects — activation calls the Template's statusCheck MCP tool and
  // gates on the fixed { configured, dashboardUrl, message? } contract.
  it("seo activation calls the statusCheck MCP tool with the submitted apiKey and persists it on success", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    const fetchMock = vi.fn().mockResolvedValue(configuredStatusCheckResponse());
    vi.stubGlobal("fetch", fetchMock);

    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        payload: { ok: true, commandId: "cmd-1", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-seo-act", label: TEMPLATE_ID, absolutePath: WORKSPACE_ABSOLUTE_PATH } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_MCP_SERVERS_MERGE_RESULT,
        payload: { ok: true, commandId: "cmd-4", instanceId: INSTANCE_ID, data: { mergedKeys: SEO_MCP_KEYS } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-6", instanceId: INSTANCE_ID, data: { agentId: TEMPLATE_ID, registered: true, configured: false } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-seo-act");
    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
        payload: { ok: true, commandId: "cmd-3", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-seo-act", filePath: "AGENTS.md" } },
      });
    addSeoMissionInstructionWriteMocks(waitForRuntimeEvent, "ws-seo-act");

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: { apiKey: "key-xyz" },
    });

    expect(result.status).toBe("active");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer key-xyz" }),
        body: expect.stringContaining('"get_project_status"'),
      }),
    );

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    expect(record?.config).toEqual({ apiKey: "key-xyz" });
    expect(record?.errorMessage).toBeUndefined();
    expect(record?.errorLink).toBeUndefined();
  });

  it("leaves the Agent in error with the MCP's message/dashboardUrl and persists apiKey when the Project is not configured", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        notConfiguredStatusCheckResponse(
          "Finish setting up your GitHub publisher",
          "https://article-mcp.example/dashboard/proj-1",
        ),
      ),
    );

    // The statusCheck gate runs right after workspace creation and before the
    // MCP merge / workspace content provisioning — a `not_configured` result
    // returns early, so only workspace creation is called.
    waitForRuntimeEvent.mockResolvedValueOnce({
      status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
      payload: { ok: true, commandId: "cmd-1", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-notcfg", label: TEMPLATE_ID, absolutePath: WORKSPACE_ABSOLUTE_PATH } },
    });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: { apiKey: "key-partial" },
    });

    expect(result).toEqual({ status: "error", errorMessage: "Finish setting up your GitHub publisher" });

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    expect(record?.status).toBe("error");
    expect(record?.errorMessage).toBe("Finish setting up your GitHub publisher");
    expect(record?.errorLink).toBe("https://article-mcp.example/dashboard/proj-1");
    // apiKey is persisted even though the Project isn't configured yet — the
    // key was accepted by the MCP, so Retry should reuse it (issue #320).
    expect(record?.config).toEqual({ apiKey: "key-partial" });
  });

  it("leaves the Agent in error without persisting apiKey when the MCP rejects the key", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        headers: JSON_RESPONSE_HEADERS,
        json: async () => ({}),
      }),
    );

    waitForRuntimeEvent.mockResolvedValueOnce({
      status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
      payload: { ok: true, commandId: "cmd-1", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-rejected", label: TEMPLATE_ID, absolutePath: WORKSPACE_ABSOLUTE_PATH } },
    });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: { apiKey: "bad-key" },
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.errorMessage).toMatch(/rejected/i);
      expect(result.errorMessage).toContain("article-mcp");
    }

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    expect(record?.status).toBe("error");
    expect(record?.errorLink).toBeUndefined();
    // The key itself was the problem — nothing is persisted, so the dashboard
    // falls back to re-opening the activation form instead of a bare Retry.
    expect(record?.config).toBeUndefined();
  });

  it("seo activation: RUNTIME_MCP_SERVERS_MERGE payload contains Authorization header from config apiKey", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(configuredStatusCheckResponse()));

    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        payload: { ok: true, commandId: "cmd-1", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-patch", label: TEMPLATE_ID, absolutePath: WORKSPACE_ABSOLUTE_PATH } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_MCP_SERVERS_MERGE_RESULT,
        payload: { ok: true, commandId: "cmd-4", instanceId: INSTANCE_ID, data: { mergedKeys: SEO_MCP_KEYS } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-6", instanceId: INSTANCE_ID, data: { agentId: TEMPLATE_ID, registered: true, configured: false } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-patch");
    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
        payload: { ok: true, commandId: "cmd-3", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-patch", filePath: "AGENTS.md" } },
      });
    addSeoMissionInstructionWriteMocks(waitForRuntimeEvent, "ws-patch");

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: { ...DEFAULT_SEO_USER_CONFIG, apiKey: "key-patch-test" },
    });

    expect(result.status).toBe("active");

    const commands = await t.run(async (ctx) => ctx.db.query("commands").collect());
    const mergeCommand = commands.find((c) => c.type === "runtime.mcp.servers.merge");
    expect(mergeCommand).toBeDefined();
    const servers = mergeCommand!.payload.servers as Record<string, Record<string, unknown>>;
    const headers = servers["article-mcp"]?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer key-patch-test");
  });

  it("hello template activation: no MCP merge command enqueued when mcpServers is empty", async () => {
    // The old test expected an empty-servers merge to be enqueued; that was the
    // bug — the runtime rejected {} with "servers must be non-empty". Now we
    // skip the merge entirely when the template has no MCP servers.
    const HELLO_TEMPLATE_ID = "@opengroow/hello";
    vi.stubEnv("OPENGROOW_ENABLE_DEMO_AGENTS", "1");
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        payload: { ok: true, commandId: "cmd-1", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-hello", label: HELLO_TEMPLATE_ID, absolutePath: "/home/node/.openclaw/workspace-ws-hello" } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-3", instanceId: INSTANCE_ID, data: { agentId: HELLO_TEMPLATE_ID, registered: true, configured: false } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-hello");
    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
        payload: { ok: true, commandId: "cmd-5", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-hello", filePath: "AGENTS.md" } },
      });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: HELLO_TEMPLATE_ID,
    });

    expect(result.status).toBe("active");
    if (result.status === "active") {
      expect(result.mcpServerKeys).toEqual([]);
    }

    const commands = await t.run(async (ctx) => ctx.db.query("commands").collect());
    const mergeCommand = commands.find((c) => c.type === "runtime.mcp.servers.merge");
    expect(mergeCommand).toBeUndefined();
  });

  it("rejects development-only template activation unless demo agents are enabled", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: "@opengroow/hello",
    });

    expect(result).toEqual({
      status: "error",
      errorMessage: "Template not available: @opengroow/hello",
    });
    expect(waitForRuntimeEvent).not.toHaveBeenCalled();
  });

  it("resolves the Template through the Project's registry: a built-in Template it does not list is not found", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: "@opengroow/video-demo",
    });

    expect(result).toEqual({ status: "error", errorMessage: "Template not found: @opengroow/video-demo" });
    expect(waitForRuntimeEvent).not.toHaveBeenCalled();
  });

  // Config Completeness has no "already provisioned, skip the call" guard
  // (issue #320, ADR-034): unlike the old activation-effect's derived-id
  // skip, every activation attempt re-runs the statusCheck — there is no
  // provisioned resource id to short-circuit on. Key rotation (deactivate,
  // then reactivate with a new key — issue #320 point 7) works because the
  // newly submitted apiKey is what gets checked and persisted.
  it("reactivation re-runs the statusCheck with a newly submitted apiKey (key rotation) and re-applies the Authorization header", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await seedProjectAgent(t, {
      workspaceKey: "ws-reactivate",
      mcpServerKeys: SEO_MCP_KEYS,
      config: { apiKey: "old-key" },
    });

    const fetchMock = vi.fn().mockResolvedValue(configuredStatusCheckResponse());
    vi.stubGlobal("fetch", fetchMock);

    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        payload: { ok: true, commandId: "cmd-1", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-reactivate", label: TEMPLATE_ID, absolutePath: WORKSPACE_ABSOLUTE_PATH } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_MCP_SERVERS_MERGE_RESULT,
        payload: { ok: true, commandId: "cmd-4", instanceId: INSTANCE_ID, data: { mergedKeys: SEO_MCP_KEYS } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-6", instanceId: INSTANCE_ID, data: { agentId: TEMPLATE_ID, registered: true, configured: false } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-reactivate");
    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
        payload: { ok: true, commandId: "cmd-3", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-reactivate", filePath: "AGENTS.md" } },
      });
    addSeoMissionInstructionWriteMocks(waitForRuntimeEvent, "ws-reactivate");

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: { apiKey: "new-api-key" },
    });

    expect(result.status).toBe("active");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer new-api-key" }) }),
    );

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    expect(record?.config).toEqual({ apiKey: "new-api-key" });

    const commands = await t.run(async (ctx) => ctx.db.query("commands").collect());
    const mergeCommand = commands.find((c) => c.type === "runtime.mcp.servers.merge");
    expect(mergeCommand).toBeDefined();
    const servers = mergeCommand!.payload.servers as Record<string, Record<string, unknown>>;
    const headers = servers["article-mcp"]?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer new-api-key");
  });

  it("reactivation keeps hiding the Mission types the operator hid (ADR-053)", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await seedProjectAgent(t, {
      workspaceKey: "ws-reactivate-hidden",
      mcpServerKeys: SEO_MCP_KEYS,
      config: { apiKey: "old-key" },
      hiddenMissionTypes: ["internal_linking"],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(configuredStatusCheckResponse()));

    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        payload: { ok: true, commandId: "cmd-1", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-reactivate-hidden", label: TEMPLATE_ID, absolutePath: WORKSPACE_ABSOLUTE_PATH } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_MCP_SERVERS_MERGE_RESULT,
        payload: { ok: true, commandId: "cmd-4", instanceId: INSTANCE_ID, data: { mergedKeys: SEO_MCP_KEYS } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-6", instanceId: INSTANCE_ID, data: { agentId: TEMPLATE_ID, registered: true, configured: false } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-reactivate-hidden", ["internal_linking.md"]);
    waitForRuntimeEvent
      .mockResolvedValueOnce(fileWriteResult("ws-reactivate-hidden", "AGENTS.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-reactivate-hidden", "create_article.md"));

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: { apiKey: "new-api-key" },
    });

    expect(result).toMatchObject({ status: "active" });
    const commands = await t.run(async (ctx) => ctx.db.query("commands").collect());
    const written = commands
      .filter((command) => command.type === "runtime.workspace.file.write")
      .map((command) => (command.payload as { filePath: string }).filePath);
    expect(written).toEqual(["AGENTS.md", "create_article.md"]);
    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    expect(record?.hiddenMissionTypes).toEqual(["internal_linking"]);
  });
});

describe("retryProjectAgentStatusCheck (issue #320, ADR-034)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("ACTIVATION_BROKER_TIMEOUT_MS", "5000");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(configuredStatusCheckResponse()));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // Regression: Retry must run the SAME provisioning tail as a first
  // activation. A `not_configured` first activation leaves the workspace
  // created but unprovisioned (no MCP merge, no AGENTS.md, no native
  // OpenClaw agent). If Retry only flipped the status to `active`, the Agent
  // would look active but be guaranteed to fail on its first Mission — the
  // exact gap this issue closes.
  it("provisions the workspace fully (MCP merge with Authorization header, native agent, workspace files) and reaches active", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    // Mirrors the persisted state after a `not_configured` first activation:
    // workspaceKey + apiKey stored, status error, nothing provisioned yet.
    await seedProjectAgent(t, {
      status: "error",
      workspaceKey: "ws-retry",
      mcpServerKeys: [],
      config: { apiKey: "key-stored" },
    });

    const fetchMock = vi.fn().mockResolvedValue(configuredStatusCheckResponse());
    vi.stubGlobal("fetch", fetchMock);

    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_MCP_SERVERS_MERGE_RESULT,
        payload: { ok: true, commandId: "cmd-merge", instanceId: INSTANCE_ID, data: { mergedKeys: SEO_MCP_KEYS } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_LIST_RESULT,
        payload: { ok: true, commandId: "cmd-list-workspaces", instanceId: INSTANCE_ID, data: { workspaces: [{ workspaceKey: "ws-retry", title: "SEO", absolutePath: "/home/node/.openclaw/workspace-ws-retry", isActive: true, kind: "project", availableFiles: [] }] } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-agents-add", instanceId: INSTANCE_ID, data: { agentId: TEMPLATE_ID, registered: true, configured: false } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-retry");
    waitForRuntimeEvent
      .mockResolvedValueOnce(fileWriteResult("ws-retry", "AGENTS.md"));
    addSeoMissionInstructionWriteMocks(waitForRuntimeEvent, "ws-retry");

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.retryProjectAgentStatusCheck, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });

    expect(result.status).toBe("active");
    // Status check re-run once with the stored key (no re-prompt).
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer key-stored" }) }),
    );

    const commands = await t.run(async (ctx) => ctx.db.query("commands").collect());
    // The MCP servers were merged with the stored apiKey's Authorization header.
    const mergeCommand = commands.find((c) => c.type === "runtime.mcp.servers.merge");
    expect(mergeCommand).toBeDefined();
    const servers = mergeCommand!.payload.servers as Record<string, Record<string, unknown>>;
    const headers = servers["article-mcp"]?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer key-stored");
    // The native OpenClaw agent was registered and the template workspace files written.
    expect(commands.some((c) => c.type === RUNTIME_AGENT_REGISTER_AND_CONFIGURE && (c.payload as { registerCommandText?: string }).registerCommandText?.includes("agents add"))).toBe(true);
    const writes = commands.filter((c) => c.type === "runtime.workspace.file.write");
    expect(writes.map((c) => (c.payload as { filePath: string }).filePath).sort()).toEqual([
      "AGENTS.md",
      "create_article.md",
      "internal_linking.md",
    ]);

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    expect(record?.status).toBe("active");
    expect(record?.openclawAgentName).toBe("opengroow--seo");
    expect(record?.config).toEqual({ apiKey: "key-stored" });
    expect(record?.mcpServerKeys).toEqual(SEO_MCP_KEYS);
  });

  it("stays in error with the MCP's message/dashboardUrl when the Project is still not configured (no provisioning)", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await seedProjectAgent(t, {
      status: "error",
      workspaceKey: "ws-retry-pending",
      mcpServerKeys: [],
      config: { apiKey: "key-stored" },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        notConfiguredStatusCheckResponse("Still finishing GitHub publisher", "https://article-mcp.example/dashboard/proj-9"),
      ),
    );

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.retryProjectAgentStatusCheck, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });

    expect(result).toEqual({ status: "error", errorMessage: "Still finishing GitHub publisher" });
    // No provisioning work is enqueued when the Project is still not configured.
    expect(waitForRuntimeEvent).not.toHaveBeenCalled();

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    expect(record?.status).toBe("error");
    expect(record?.errorMessage).toBe("Still finishing GitHub publisher");
    expect(record?.errorLink).toBe("https://article-mcp.example/dashboard/proj-9");
  });

  it("returns an error without calling the MCP when no apiKey is on file", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    const fetchMock = vi.fn().mockResolvedValue(configuredStatusCheckResponse());
    vi.stubGlobal("fetch", fetchMock);
    await seedInstance(t);
    await seedProjectAgent(t, { status: "error", workspaceKey: "ws-nokey", mcpServerKeys: [], config: undefined });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.retryProjectAgentStatusCheck, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.errorMessage).toMatch(/reactivate/i);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(waitForRuntimeEvent).not.toHaveBeenCalled();
  });
});

describe("refreshProjectAgent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("ACTIVATION_BROKER_TIMEOUT_MS", "5000");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: JSON_RESPONSE_HEADERS,
      json: async () => ({ result: { content: [] } }),
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("refreshes an active agent by registering the existing workspace and writing template workspace files", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    const template = await officialFixtureTemplate(TEMPLATE_ID);
    await seedInstance(t);
    await seedProjectAgent(t, {
      workspaceKey: "ws-refresh",
      mcpServerKeys: SEO_MCP_KEYS,
      config: { seoProjectId: "proj-existing", apiKey: "stored-key" },
    });

    waitForRuntimeEvent
      .mockResolvedValueOnce(workspaceListResult("ws-refresh"))
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-register", instanceId: INSTANCE_ID, data: { agentId: TEMPLATE_ID, alreadyRegistered: true, registered: true, configured: false, workspace: "/home/node/.openclaw/workspace-ws-refresh" } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-refresh");
    waitForRuntimeEvent
      .mockResolvedValueOnce(fileWriteResult("ws-refresh", "AGENTS.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-refresh", "create_article.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-refresh", "internal_linking.md"));

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.refreshProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });

    expect(result).toEqual({ status: "refreshed", workspaceKey: "ws-refresh" });

    const commands = await t.run(async (ctx) => ctx.db.query("commands").collect());
    // The compound command needs the workspace path to build its `agents add`
    // step, so it is resolved first even when the agent turns out to already
    // be registered.
    expect(commands.map((command) => command.type)).toEqual([
      RUNTIME_WORKSPACE_LIST,
      RUNTIME_AGENT_REGISTER_AND_CONFIGURE,
      "runtime.workspace.file.delete_batch",
      "runtime.workspace.file.write",
      "runtime.workspace.file.write",
      "runtime.workspace.file.write",
    ]);
    expect(commands[1].payload).toMatchObject({ listCommandText: "openclaw agents list --json" });
    expect(commands[3].payload).toEqual({
      workspaceKey: "ws-refresh",
      filePath: "AGENTS.md",
      content: template.agentsMd,
    });
    expect(commands[4].payload).toEqual({
      workspaceKey: "ws-refresh",
      filePath: "create_article.md",
      content: template.missionAgentsMd?.create_article,
    });
    expect(commands[5].payload).toEqual({
      workspaceKey: "ws-refresh",
      filePath: "internal_linking.md",
      content: template.missionAgentsMd?.internal_linking,
    });
  });

  it("does not write the instruction file of a hidden Mission type on refresh (ADR-053)", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await seedProjectAgent(t, {
      workspaceKey: "ws-hidden",
      mcpServerKeys: SEO_MCP_KEYS,
      config: { seoProjectId: "proj-existing", apiKey: "stored-key" },
      hiddenMissionTypes: ["internal_linking"],
    });

    waitForRuntimeEvent
      .mockResolvedValueOnce(workspaceListResult("ws-hidden"))
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-register", instanceId: INSTANCE_ID, data: { agentId: TEMPLATE_ID, alreadyRegistered: true, registered: true, configured: false, workspace: "/home/node/.openclaw/workspace-ws-hidden" } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-hidden");
    waitForRuntimeEvent
      .mockResolvedValueOnce(fileWriteResult("ws-hidden", "AGENTS.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-hidden", "create_article.md"));

    await t.withIdentity(TEST_USER).action(api.project_agents_node.refreshProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });

    const commands = await t.run(async (ctx) => ctx.db.query("commands").collect());
    const written = commands
      .filter((command) => command.type === "runtime.workspace.file.write")
      .map((command) => (command.payload as { filePath: string }).filePath);
    expect(written).toEqual(["AGENTS.md", "create_article.md"]);
  });

  it("deletes the already-materialized instruction file of a hidden Mission type on refresh (ADR-053)", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await seedProjectAgent(t, {
      workspaceKey: "ws-hidden-delete",
      mcpServerKeys: SEO_MCP_KEYS,
      config: { seoProjectId: "proj-existing", apiKey: "stored-key" },
      hiddenMissionTypes: ["internal_linking", "removed_type"],
    });

    waitForRuntimeEvent
      .mockResolvedValueOnce(workspaceListResult("ws-hidden-delete"))
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-register", instanceId: INSTANCE_ID, data: { agentId: TEMPLATE_ID, alreadyRegistered: true, registered: true, configured: false, workspace: "/home/node/.openclaw/workspace-ws-hidden-delete" } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-hidden-delete", ["internal_linking.md"]);
    waitForRuntimeEvent
      .mockResolvedValueOnce(fileWriteResult("ws-hidden-delete", "AGENTS.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-hidden-delete", "create_article.md"));

    await t.withIdentity(TEST_USER).action(api.project_agents_node.refreshProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });

    const commands = await t.run(async (ctx) => ctx.db.query("commands").collect());
    const batch = commands.find((command) => command.type === "runtime.workspace.file.delete_batch");
    const deleted = (batch?.payload as { filePaths: string[] }).filePaths;
    expect(deleted).toContain("internal_linking.md");
    // Only the instruction file of a type the Template declares: a stale name is not turned into a path.
    expect(deleted).not.toContain("removed_type.md");
    // The visible type's file is never deleted.
    expect(deleted).not.toContain("create_article.md");
    // The refresh upsert keeps the operator's setting as-is, stale names included.
    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    expect(record?.hiddenMissionTypes).toEqual(["internal_linking", "removed_type"]);
  });

  it("preserves project agent status, workspaceKey, config, and mcpServerKeys", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await seedProjectAgent(t, {
      workspaceKey: "ws-preserve-refresh",
      mcpServerKeys: ["article-mcp", "extra-mcp"],
      config: { seoProjectId: "proj-preserve", apiKey: "key-preserve" },
    });

    waitForRuntimeEvent
      .mockResolvedValueOnce(workspaceListResult("ws-preserve-refresh"))
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-register", instanceId: INSTANCE_ID, data: { agentId: TEMPLATE_ID, alreadyRegistered: true, registered: true, configured: false, workspace: "/home/node/.openclaw/workspace-ws-preserve-refresh" } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-preserve-refresh");
    waitForRuntimeEvent
      .mockResolvedValueOnce(fileWriteResult("ws-preserve-refresh", "AGENTS.md"));
    addSeoMissionInstructionWriteMocks(waitForRuntimeEvent, "ws-preserve-refresh");

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.refreshProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });

    expect(result.status).toBe("refreshed");
    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    expect(record?.status).toBe("active");
    expect(record?.workspaceKey).toBe("ws-preserve-refresh");
    expect(record?.config).toEqual({ seoProjectId: "proj-preserve", apiKey: "key-preserve" });
    expect(record?.mcpServerKeys).toEqual(["article-mcp", "extra-mcp"]);
  });

  it("adds a missing native OpenClaw agent for the existing workspace", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await seedProjectAgent(t, { workspaceKey: "ws-missing-native" });

    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_LIST_RESULT,
        payload: { ok: true, commandId: "cmd-list-workspaces", instanceId: INSTANCE_ID, data: { workspaces: [{ workspaceKey: "ws-missing-native", title: "SEO", absolutePath: "/home/node/.openclaw/workspace-ws-missing-native", isActive: true, kind: "project", availableFiles: [] }] } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-agents-add", instanceId: INSTANCE_ID, data: { agentId: TEMPLATE_ID, registered: true, configured: false } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-missing-native");
    waitForRuntimeEvent
      .mockResolvedValueOnce(fileWriteResult("ws-missing-native", "AGENTS.md"));
    addSeoMissionInstructionWriteMocks(waitForRuntimeEvent, "ws-missing-native");

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.refreshProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });

    expect(result.status).toBe("refreshed");
    const commands = await t.run(async (ctx) => ctx.db.query("commands").collect());
    expect(commands.map((command) => command.type)).toEqual([
      RUNTIME_WORKSPACE_LIST,
      RUNTIME_AGENT_REGISTER_AND_CONFIGURE,
      "runtime.workspace.file.delete_batch",
      "runtime.workspace.file.write",
      "runtime.workspace.file.write",
      "runtime.workspace.file.write",
    ]);
    expect(commands[1].payload).toMatchObject({
      agentId: "opengroow--seo",
      registerCommandText: "openclaw agents add opengroow--seo --workspace /home/node/.openclaw/workspace-ws-missing-native --non-interactive --json",
    });
  });

  it("returns error when the agent is missing, inactive, or missing workspaceKey", async () => {
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();

    const missing = convexTest(schema, modules);
    await seedInstance(missing);
    await expect(
      missing.withIdentity(TEST_USER).action(api.project_agents_node.refreshProjectAgent, {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
      }),
    ).resolves.toEqual({ status: "error", errorMessage: "Agent not found" });

    const inactive = convexTest(schema, modules);
    await seedInstance(inactive);
    await seedProjectAgent(inactive, { status: "inactive", workspaceKey: "ws-inactive" });
    await expect(
      inactive.withIdentity(TEST_USER).action(api.project_agents_node.refreshProjectAgent, {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
      }),
    ).resolves.toEqual({ status: "error", errorMessage: "Agent must be active to refresh" });

    const noWorkspace = convexTest(schema, modules);
    await seedInstance(noWorkspace);
    await seedProjectAgent(noWorkspace);
    await expect(
      noWorkspace.withIdentity(TEST_USER).action(api.project_agents_node.refreshProjectAgent, {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
      }),
    ).resolves.toEqual({ status: "error", errorMessage: "Agent workspace not found" });

    expect(waitForRuntimeEvent).not.toHaveBeenCalled();
  });

  it("returns error when AGENTS.md cannot be written", async () => {
    const agentsFailure = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(agentsFailure);
    await seedProjectAgent(agentsFailure, { workspaceKey: "ws-agents-failure" });

    waitForRuntimeEvent
      .mockResolvedValueOnce(workspaceListResult("ws-agents-failure"))
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-register", instanceId: INSTANCE_ID, data: { agentId: TEMPLATE_ID, alreadyRegistered: true, registered: true, configured: false } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-agents-failure");
    waitForRuntimeEvent
      .mockResolvedValueOnce(fileWriteResult("ws-agents-failure", "AGENTS.md", false, "AGENTS denied"));

    await expect(
      agentsFailure.withIdentity(TEST_USER).action(api.project_agents_node.refreshProjectAgent, {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
      }),
    ).resolves.toEqual({ status: "error", errorMessage: "AGENTS denied" });
  });

  it("returns error when a declared per-mission instruction file cannot be written", async () => {
    const instructionFailure = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(instructionFailure);
    await seedProjectAgent(instructionFailure, { workspaceKey: "ws-instruction-failure" });

    waitForRuntimeEvent.mockResolvedValueOnce(workspaceListResult("ws-instruction-failure"));
    waitForRuntimeEvent.mockResolvedValueOnce({
      status: 200,
      found: true,
      type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
      payload: {
        ok: true,
        commandId: "cmd-register",
        instanceId: INSTANCE_ID,
        data: { agentId: TEMPLATE_ID, alreadyRegistered: true, registered: true, configured: false },
      },
    });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-instruction-failure");
    waitForRuntimeEvent
      .mockResolvedValueOnce(fileWriteResult("ws-instruction-failure", "AGENTS.md"))
      .mockResolvedValueOnce(
        fileWriteResult(
          "ws-instruction-failure",
          "create_article.md",
          false,
          "Mission instructions denied",
        ),
      );

    await expect(
      instructionFailure.withIdentity(TEST_USER).action(
        api.project_agents_node.refreshProjectAgent,
        {
          instanceId: INSTANCE_ID,
          templateId: TEMPLATE_ID,
        },
      ),
    ).resolves.toEqual({
      status: "error",
      errorMessage: "Mission instructions denied",
    });
  });

  it("does not call MCP merge, default file deletion, template activation, or fetch", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await seedProjectAgent(t, { workspaceKey: "ws-no-activation" });

    waitForRuntimeEvent
      .mockResolvedValueOnce(workspaceListResult("ws-no-activation"))
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-register", instanceId: INSTANCE_ID, data: { agentId: TEMPLATE_ID, alreadyRegistered: true, registered: true, configured: false } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-no-activation");
    waitForRuntimeEvent
      .mockResolvedValueOnce(fileWriteResult("ws-no-activation", "AGENTS.md"));
    addSeoMissionInstructionWriteMocks(waitForRuntimeEvent, "ws-no-activation");

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.refreshProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });

    expect(result.status).toBe("refreshed");
    expect(fetch).not.toHaveBeenCalled();

    const commands = await t.run(async (ctx) => ctx.db.query("commands").collect());
    expect(commands.map((command) => command.type)).toEqual([
      RUNTIME_WORKSPACE_LIST,
      RUNTIME_AGENT_REGISTER_AND_CONFIGURE,
      "runtime.workspace.file.delete_batch",
      "runtime.workspace.file.write",
      "runtime.workspace.file.write",
      "runtime.workspace.file.write",
    ]);
  });
});

describe("Template-declared Agent Skills (issue #222)", () => {
  const SOCIAL_TEMPLATE_ID = "@opengroow/engagement";
  const SOCIAL_USER_CONFIG = {
    // Required BYOK field since issue #455 added feed-mcp.
    apiKey: "key-social-skills-test",
    accountHandleInstagram: "@testaccount",
    accountHandleTiktok: "@testaccount.tt",
    accountBio: "Street photography account based in Paris.",
    likeWhen: "Street photography, urban architecture, B&W photography",
    classifierApiKey: "agent-key-social-skills-test",
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("ACTIVATION_BROKER_TIMEOUT_MS", "5000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("activation fails and leaves the Agent in status: error when a required Template skill fails to install", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        payload: { ok: true, commandId: "cmd-1", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-social-fail", label: SOCIAL_TEMPLATE_ID, absolutePath: WORKSPACE_ABSOLUTE_PATH } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_MCP_SERVERS_MERGE_RESULT,
        payload: { ok: true, commandId: "cmd-2", instanceId: INSTANCE_ID, data: { mergedKeys: ["feed-mcp"] } },
      })
      // registerNativeOpenClawAgent: one compound command that runs
      // `openclaw agents add` then the tool deny-list `config set`.
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-3", instanceId: INSTANCE_ID, data: { agentId: SOCIAL_TEMPLATE_ID, registered: true, configured: true } },
      })
      .mockResolvedValueOnce(agentCredentialResult(SOCIAL_TEMPLATE_ID));
    addFileDeleteMocks(waitForRuntimeEvent, "ws-social-fail");
    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
        payload: { ok: true, commandId: "cmd-agents", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-social-fail", filePath: "AGENTS.md" } },
      })
      .mockResolvedValueOnce(fileWriteResult("ws-social-fail", "engage.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-social-fail", "sources/video-post.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-social-fail", "sources/image-post.md"))
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_OPENCLAW_EXEC_RESULT,
        payload: { ok: false, commandId: "cmd-skill-install", instanceId: INSTANCE_ID, error: "skill not found on ClawHub" },
      });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: SOCIAL_TEMPLATE_ID,
      userConfig: SOCIAL_USER_CONFIG,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.errorMessage).toContain("humanize");
      expect(result.errorMessage).toContain("skill not found on ClawHub");
    }

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: SOCIAL_TEMPLATE_ID,
    });
    expect(record?.status).toBe("error");
    expect(record?.errorMessage).toContain("humanize");
    expect(record?.skills).toEqual([
      expect.objectContaining({
        source: "clawhub",
        spec: "humanize",
        origin: "template",
        status: "error",
        errorMessage: "skill not found on ClawHub",
      }),
    ]);
  });

  it("re-activation of a template with no activation effect merges the freshly submitted userConfig over the stored config, instead of discarding it", async () => {
    // Regression: a template like social-engagement has no declarative
    // `activation` effect. Deactivating an Agent never clears its stored
    // `config` — re-activating it must persist the newly submitted
    // userConfig (merged over the old one), not silently keep serving the
    // stale config from before deactivation.
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await seedProjectAgent(t, {
      templateId: SOCIAL_TEMPLATE_ID,
      status: "inactive",
      workspaceKey: "ws-social-reactivate",
      config: {
        apiKey: "key-old",
        accountHandleInstagram: "@old_handle",
        accountHandleTiktok: "@old_handle.tt",
        accountBio: "Old bio",
        likeWhen: "Old like when",
        classifierApiKey: "agent-key-old",
      },
    });

    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        payload: { ok: true, commandId: "cmd-1", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-social-reactivate", label: SOCIAL_TEMPLATE_ID, absolutePath: WORKSPACE_ABSOLUTE_PATH } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_MCP_SERVERS_MERGE_RESULT,
        payload: { ok: true, commandId: "cmd-2", instanceId: INSTANCE_ID, data: { mergedKeys: ["feed-mcp"] } },
      })
      // registerNativeOpenClawAgent: one compound command that runs
      // `openclaw agents add` then the tool deny-list `config set`.
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-3", instanceId: INSTANCE_ID, data: { agentId: SOCIAL_TEMPLATE_ID, registered: true, configured: true } },
      })
      .mockResolvedValueOnce(agentCredentialResult(SOCIAL_TEMPLATE_ID));
    addFileDeleteMocks(waitForRuntimeEvent, "ws-social-reactivate");
    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
        payload: { ok: true, commandId: "cmd-agents", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-social-reactivate", filePath: "AGENTS.md" } },
      })
      .mockResolvedValueOnce(fileWriteResult("ws-social-reactivate", "engage.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-social-reactivate", "sources/video-post.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-social-reactivate", "sources/image-post.md"))
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_OPENCLAW_EXEC_RESULT,
        payload: { ok: true, commandId: "cmd-skill-install", instanceId: INSTANCE_ID, data: { output: "" } },
      })
      .mockResolvedValueOnce(pluginsInstallResult(false));

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: SOCIAL_TEMPLATE_ID,
      userConfig: {
        apiKey: "key-new",
        accountHandleInstagram: "@new_handle",
        accountHandleTiktok: "@old_handle.tt",
        accountBio: "New bio",
        likeWhen: "New like when",
        avoid: "New avoid",
        classifierApiKey: "agent-key-new",
      },
    });

    expect(result.status).toBe("active");

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: SOCIAL_TEMPLATE_ID,
    });
    expect(record?.config).toEqual({
      apiKey: "key-new",
      accountHandleInstagram: "@new_handle",
      accountHandleTiktok: "@old_handle.tt",
      accountBio: "New bio",
      likeWhen: "New like when",
      avoid: "New avoid",
      classifierApiKey: "agent-key-new",
    });
  });

  it("refresh installs required Template skills and persists them with origin: template", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await seedProjectAgent(t, {
      templateId: SOCIAL_TEMPLATE_ID,
      workspaceKey: "ws-social-refresh",
    });

    waitForRuntimeEvent
      .mockResolvedValueOnce(workspaceListResult("ws-social-refresh", "engagement"))
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-register", instanceId: INSTANCE_ID, data: { agentId: SOCIAL_TEMPLATE_ID, alreadyRegistered: true, registered: true, configured: false, workspace: "/home/node/.openclaw/workspace-ws-social-refresh" } },
      })
      .mockResolvedValueOnce(agentCredentialResult(SOCIAL_TEMPLATE_ID));
    addFileDeleteMocks(waitForRuntimeEvent, "ws-social-refresh");
    waitForRuntimeEvent
      .mockResolvedValueOnce(fileWriteResult("ws-social-refresh", "AGENTS.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-social-refresh", "engage.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-social-refresh", "sources/video-post.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-social-refresh", "sources/image-post.md"))
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_OPENCLAW_EXEC_RESULT,
        payload: { ok: true, commandId: "cmd-skill-install", instanceId: INSTANCE_ID, data: { output: "" } },
      })
      .mockResolvedValueOnce(pluginsInstallResult(false));

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.refreshProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: SOCIAL_TEMPLATE_ID,
    });

    expect(result).toEqual({ status: "refreshed", workspaceKey: "ws-social-refresh" });

    const commands = await t.run(async (ctx) => ctx.db.query("commands").collect());
    const skillInstallCommand = commands.find(
      (c) => c.type === RUNTIME_OPENCLAW_EXEC && (c.payload as { commandText?: string }).commandText?.includes("clawhub install"),
    );
    expect(skillInstallCommand?.payload).toEqual({
      commandText: "clawhub install humanize --workdir /home/node/.openclaw/workspace-ws-social-refresh",
    });

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: SOCIAL_TEMPLATE_ID,
    });
    expect(record?.status).toBe("active");
    expect(record?.skills).toEqual([
      expect.objectContaining({ source: "clawhub", spec: "humanize", origin: "template", status: "installed" }),
    ]);
  });

  it("refresh fails and marks the Agent status: error when a required Template skill fails to install", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await seedProjectAgent(t, {
      templateId: SOCIAL_TEMPLATE_ID,
      workspaceKey: "ws-social-refresh-fail",
    });

    waitForRuntimeEvent
      .mockResolvedValueOnce(workspaceListResult("ws-social-refresh-fail", "engagement"))
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-register", instanceId: INSTANCE_ID, data: { agentId: SOCIAL_TEMPLATE_ID, alreadyRegistered: true, registered: true, configured: false, workspace: "/home/node/.openclaw/workspace-ws-social-refresh-fail" } },
      })
      .mockResolvedValueOnce(agentCredentialResult(SOCIAL_TEMPLATE_ID));
    addFileDeleteMocks(waitForRuntimeEvent, "ws-social-refresh-fail");
    waitForRuntimeEvent
      .mockResolvedValueOnce(fileWriteResult("ws-social-refresh-fail", "AGENTS.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-social-refresh-fail", "engage.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-social-refresh-fail", "sources/video-post.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-social-refresh-fail", "sources/image-post.md"))
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_OPENCLAW_EXEC_RESULT,
        payload: { ok: false, commandId: "cmd-skill-install", instanceId: INSTANCE_ID, error: "network error" },
      });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.refreshProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: SOCIAL_TEMPLATE_ID,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.errorMessage).toContain("humanize");
      expect(result.errorMessage).toContain("network error");
    }

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: SOCIAL_TEMPLATE_ID,
    });
    expect(record?.status).toBe("error");
    expect(record?.errorMessage).toContain("humanize");
  });

  it("refresh replaces an existing entry for the same skill instead of duplicating it", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await seedProjectAgent(t, {
      templateId: SOCIAL_TEMPLATE_ID,
      workspaceKey: "ws-social-dup",
      skills: [
        { source: "clawhub", spec: "humanize", origin: "template", status: "error", updatedAt: Date.now() - 10_000, errorMessage: "previously failed" },
      ],
    });

    waitForRuntimeEvent
      .mockResolvedValueOnce(workspaceListResult("ws-social-dup", "engagement"))
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-register", instanceId: INSTANCE_ID, data: { agentId: SOCIAL_TEMPLATE_ID, alreadyRegistered: true, registered: true, configured: false, workspace: "/home/node/.openclaw/workspace-ws-social-dup" } },
      })
      .mockResolvedValueOnce(agentCredentialResult(SOCIAL_TEMPLATE_ID));
    addFileDeleteMocks(waitForRuntimeEvent, "ws-social-dup");
    waitForRuntimeEvent
      .mockResolvedValueOnce(fileWriteResult("ws-social-dup", "AGENTS.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-social-dup", "engage.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-social-dup", "sources/video-post.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-social-dup", "sources/image-post.md"))
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_OPENCLAW_EXEC_RESULT,
        payload: { ok: true, commandId: "cmd-skill-install", instanceId: INSTANCE_ID, data: { output: "" } },
      });

    await t.withIdentity(TEST_USER).action(api.project_agents_node.refreshProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: SOCIAL_TEMPLATE_ID,
    });

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: SOCIAL_TEMPLATE_ID,
    });
    // Exactly one entry for humanize — the stale "error" entry was replaced, not duplicated.
    expect(record?.skills).toHaveLength(1);
    expect(record?.skills?.[0]).toEqual(
      expect.objectContaining({ source: "clawhub", spec: "humanize", origin: "template", status: "installed" }),
    );
  });

  it("refresh removes a stale origin:template skill no longer declared by the Template", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await seedProjectAgent(t, {
      templateId: SOCIAL_TEMPLATE_ID,
      workspaceKey: "ws-social-stale",
      skills: [
        { source: "clawhub", spec: "old-retired-skill", origin: "template", status: "installed", updatedAt: Date.now() - 10_000 },
      ],
    });

    waitForRuntimeEvent
      .mockResolvedValueOnce(workspaceListResult("ws-social-stale", "engagement"))
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-register", instanceId: INSTANCE_ID, data: { agentId: SOCIAL_TEMPLATE_ID, alreadyRegistered: true, registered: true, configured: false, workspace: "/home/node/.openclaw/workspace-ws-social-stale" } },
      })
      .mockResolvedValueOnce(agentCredentialResult(SOCIAL_TEMPLATE_ID));
    addFileDeleteMocks(waitForRuntimeEvent, "ws-social-stale");
    waitForRuntimeEvent
      .mockResolvedValueOnce(fileWriteResult("ws-social-stale", "AGENTS.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-social-stale", "engage.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-social-stale", "sources/video-post.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-social-stale", "sources/image-post.md"))
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_OPENCLAW_EXEC_RESULT,
        payload: { ok: true, commandId: "cmd-skill-install", instanceId: INSTANCE_ID, data: { output: "" } },
      });

    await t.withIdentity(TEST_USER).action(api.project_agents_node.refreshProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: SOCIAL_TEMPLATE_ID,
    });

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: SOCIAL_TEMPLATE_ID,
    });
    const specs = record?.skills?.map((s) => s.spec) ?? [];
    expect(specs).not.toContain("old-retired-skill");
    expect(specs).toContain("humanize");
  });
});

describe("Template-declared OpenClaw plugins (#661)", () => {
  const SOCIAL_TEMPLATE_ID = "@opengroow/engagement";
  const WORKSPACE_KEY = "ws-social-plugins";

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("ACTIVATION_BROKER_TIMEOUT_MS", "5000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // Everything a refresh of social-engagement sends before the plugin step.
  // Reconciliation first re-creates the workspace (a reprovisioned Instance no
  // longer has it), which also tells it the absolute path: no workspace list.
  async function mockRefreshUpToPlugins(options: { reconcile?: boolean } = {}) {
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    waitForRuntimeEvent.mockResolvedValueOnce(
      options.reconcile
        ? {
            status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
            payload: { ok: true, commandId: "cmd-create", instanceId: INSTANCE_ID, data: { workspaceKey: WORKSPACE_KEY, label: SOCIAL_TEMPLATE_ID, absolutePath: `/home/node/.openclaw/workspace-${WORKSPACE_KEY}` } },
          }
        : workspaceListResult(WORKSPACE_KEY, SOCIAL_TEMPLATE_ID),
    );
    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-register", instanceId: INSTANCE_ID, data: { agentId: SOCIAL_TEMPLATE_ID, alreadyRegistered: true, registered: true, configured: false, workspace: `/home/node/.openclaw/workspace-${WORKSPACE_KEY}` } },
      })
      .mockResolvedValueOnce(agentCredentialResult(SOCIAL_TEMPLATE_ID));
    addFileDeleteMocks(waitForRuntimeEvent, WORKSPACE_KEY);
    waitForRuntimeEvent
      .mockResolvedValueOnce(fileWriteResult(WORKSPACE_KEY, "AGENTS.md"))
      .mockResolvedValueOnce(fileWriteResult(WORKSPACE_KEY, "engage.md"))
      .mockResolvedValueOnce(fileWriteResult(WORKSPACE_KEY, "sources/video-post.md"))
      .mockResolvedValueOnce(fileWriteResult(WORKSPACE_KEY, "sources/image-post.md"))
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_OPENCLAW_EXEC_RESULT,
        payload: { ok: true, commandId: "cmd-skill-install", instanceId: INSTANCE_ID, data: { output: "" } },
      });
    return waitForRuntimeEvent;
  }

  async function seedSocialAgent(t: ReturnType<typeof convexTest>) {
    await seedInstance(t);
    await seedProjectAgent(t, { templateId: SOCIAL_TEMPLATE_ID, workspaceKey: WORKSPACE_KEY });
  }

  const commandsOfType = async (t: ReturnType<typeof convexTest>, type: string) =>
    (await t.run(async (ctx) => ctx.db.query("commands").collect())).filter((c) => c.type === type);

  const restartCommands = async (t: ReturnType<typeof convexTest>) =>
    (await commandsOfType(t, RUNTIME_OPENCLAW_EXEC)).filter(
      (c) => (c.payload as { commandText?: string }).commandText === "openclaw gateway restart",
    );

  it("installs the Template's plugin files into the Instance, then restarts the Gateway because the plugin changed", async () => {
    const t = convexTest(schema, modules);
    await seedSocialAgent(t);
    const waitForRuntimeEvent = await mockRefreshUpToPlugins();
    waitForRuntimeEvent.mockResolvedValueOnce(pluginsInstallResult(true)).mockResolvedValueOnce(gatewayRestartResult());

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.refreshProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: SOCIAL_TEMPLATE_ID,
    });

    expect(result).toEqual({ status: "refreshed", workspaceKey: WORKSPACE_KEY });
    const [install] = await commandsOfType(t, RUNTIME_PLUGINS_INSTALL);
    const { plugins } = install!.payload as { plugins: Array<{ id: string; files: Array<{ path: string; content: string }> }> };
    expect(plugins.map((p) => p.id)).toEqual(["engagement-report-sync"]);
    expect(plugins[0]!.files.map((f) => f.path)).toEqual(expect.arrayContaining(["package.json", "openclaw.plugin.json", "dist/index.js"]));
    expect(await restartCommands(t)).toHaveLength(1);
  });

  it("does not restart the Gateway when the identical plugin is already installed", async () => {
    const t = convexTest(schema, modules);
    await seedSocialAgent(t);
    const waitForRuntimeEvent = await mockRefreshUpToPlugins();
    waitForRuntimeEvent.mockResolvedValueOnce(pluginsInstallResult(false));

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.refreshProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: SOCIAL_TEMPLATE_ID,
    });

    expect(result.status).toBe("refreshed");
    expect(await commandsOfType(t, RUNTIME_PLUGINS_INSTALL)).toHaveLength(1);
    expect(await restartCommands(t)).toHaveLength(0);
  });

  it("marks the Agent in error, naming the plugin failure, when the install is refused", async () => {
    const t = convexTest(schema, modules);
    await seedSocialAgent(t);
    const waitForRuntimeEvent = await mockRefreshUpToPlugins();
    waitForRuntimeEvent.mockResolvedValueOnce({
      status: 200, found: true, type: RUNTIME_PLUGINS_INSTALL_RESULT,
      payload: { ok: false, commandId: "cmd-plugins-install", instanceId: INSTANCE_ID, error: "unsafe file path", data: { plugins: [] } },
    });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.refreshProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: SOCIAL_TEMPLATE_ID,
    });

    expect(result).toEqual({ status: "error", errorMessage: "Failed to install Template plugin(s): unsafe file path" });
    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, { instanceId: INSTANCE_ID, templateId: SOCIAL_TEMPLATE_ID });
    expect(record?.status).toBe("error");
    expect(await restartCommands(t)).toHaveLength(0);
  });

  it("tells the operator to update the runtime when the Instance does not know the plugin command", async () => {
    const t = convexTest(schema, modules);
    await seedSocialAgent(t);
    const waitForRuntimeEvent = await mockRefreshUpToPlugins();
    waitForRuntimeEvent.mockResolvedValueOnce({
      status: 200, found: true, type: RUNTIME_COMMAND_UNSUPPORTED,
      payload: { ok: false, commandId: "cmd-plugins-install", instanceId: INSTANCE_ID },
    });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.refreshProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: SOCIAL_TEMPLATE_ID,
    });

    expect(result).toEqual({
      status: "error",
      errorMessage: expect.stringMatching(/does not support installing Template plugins.*update/),
    });
  });

  it("reconciling the Instance reinstalls the plugin and restarts the Gateway once, after the Agents", async () => {
    const t = convexTest(schema, modules);
    await seedSocialAgent(t);
    const waitForRuntimeEvent = await mockRefreshUpToPlugins({ reconcile: true });
    waitForRuntimeEvent.mockResolvedValueOnce(pluginsInstallResult(true)).mockResolvedValueOnce(gatewayRestartResult());

    const outcomes = await t.action(internal.project_agents_node.reconcileInstanceAgents, { instanceId: INSTANCE_ID });

    expect(outcomes).toEqual([{ templateId: SOCIAL_TEMPLATE_ID, status: "refreshed" }]);
    expect(await commandsOfType(t, RUNTIME_PLUGINS_INSTALL)).toHaveLength(1);
    expect(await restartCommands(t)).toHaveLength(1);
  });
});

describe("addAgentSkill (issue #224)", () => {
  const WS_KEY = "ws-user-skill";
  const WS_ABS_PATH = "/home/node/.openclaw/workspace-ws-user-skill";

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("ACTIVATION_BROKER_TIMEOUT_MS", "5000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function userSkillWorkspaceListResult() {
    return {
      status: 200, found: true, type: RUNTIME_WORKSPACE_LIST_RESULT,
      payload: {
        ok: true,
        commandId: "cmd-list-workspaces",
        instanceId: INSTANCE_ID,
        data: { workspaces: [{ workspaceKey: WS_KEY, title: TEMPLATE_ID, absolutePath: WS_ABS_PATH, isActive: true, kind: "project", availableFiles: [] }] },
      },
    };
  }

  it("installs a new user-added skill and persists it with origin: user, status: installed", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await seedProjectAgent(t, { workspaceKey: WS_KEY });

    waitForRuntimeEvent
      .mockResolvedValueOnce(userSkillWorkspaceListResult())
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_OPENCLAW_EXEC_RESULT,
        payload: { ok: true, commandId: "cmd-skill-install", instanceId: INSTANCE_ID, data: { output: "" } },
      });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.addAgentSkill, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      spec: "  my-clawhub-skill  ",
    });

    expect(result).toEqual({
      status: "installed",
      skill: expect.objectContaining({
        source: "clawhub",
        spec: "my-clawhub-skill",
        origin: "user",
        status: "installed",
      }),
    });

    const commands = await t.run(async (ctx) => ctx.db.query("commands").collect());
    const installCommand = commands.find(
      (c) => c.type === RUNTIME_OPENCLAW_EXEC && (c.payload as { commandText?: string }).commandText?.includes("clawhub install"),
    );
    expect(installCommand?.payload).toEqual({
      commandText: `clawhub install my-clawhub-skill --workdir ${WS_ABS_PATH}`,
    });

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    expect(record?.status).toBe("active");
    expect(record?.skills).toEqual([
      expect.objectContaining({ source: "clawhub", spec: "my-clawhub-skill", origin: "user", status: "installed" }),
    ]);
  });

  it("keeps the Agent active and persists status: error with a message when install fails", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await seedProjectAgent(t, { workspaceKey: WS_KEY });

    waitForRuntimeEvent
      .mockResolvedValueOnce(userSkillWorkspaceListResult())
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_OPENCLAW_EXEC_RESULT,
        payload: { ok: false, commandId: "cmd-skill-install", instanceId: INSTANCE_ID, error: "skill not found on ClawHub" },
      });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.addAgentSkill, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      spec: "missing-skill",
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.errorMessage).toContain("skill not found on ClawHub");
    }

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    // Agent stays active — a failed user-added skill install must not flip the Agent to error.
    expect(record?.status).toBe("active");
    expect(record?.skills).toEqual([
      expect.objectContaining({
        source: "clawhub",
        spec: "missing-skill",
        origin: "user",
        status: "error",
        errorMessage: "skill not found on ClawHub",
      }),
    ]);
  });

  it("rejects a blank spec without calling the runtime", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await seedProjectAgent(t, { workspaceKey: WS_KEY });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.addAgentSkill, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      spec: "   ",
    });

    expect(result).toEqual({ status: "error", errorMessage: "Skill name is required" });
    expect(waitForRuntimeEvent).not.toHaveBeenCalled();
  });

  it("rejects when the Agent is not active", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await seedProjectAgent(t, { status: "inactive", workspaceKey: WS_KEY });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.addAgentSkill, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      spec: "some-skill",
    });

    expect(result).toEqual({ status: "error", errorMessage: "Agent must be active to add a skill" });
    expect(waitForRuntimeEvent).not.toHaveBeenCalled();
  });

  it("rejects for a caller who does not own the instance", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t, { workspaceKey: WS_KEY });

    const result = await t.withIdentity(OTHER_USER).action(api.project_agents_node.addAgentSkill, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      spec: "some-skill",
    });

    expect(result).toEqual({ status: "error", errorMessage: "Forbidden" });
  });

  it("reports already_required and does not call OpenClaw when the skill is already a required Template skill", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    const existingTemplateSkill: SeededProjectAgentSkill = {
      source: "clawhub", spec: "humanize", origin: "template", status: "installed", updatedAt: Date.now(),
    };
    await seedProjectAgent(t, { workspaceKey: WS_KEY, skills: [existingTemplateSkill] });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.addAgentSkill, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      spec: "humanize",
    });

    expect(result).toEqual({
      status: "already_required",
      skill: expect.objectContaining({ source: "clawhub", spec: "humanize", origin: "template" }),
    });
    expect(waitForRuntimeEvent).not.toHaveBeenCalled();

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    // No duplicate origin: user entry was created.
    expect(record?.skills).toHaveLength(1);
  });

  it("reconciles via OpenClaw and replaces the existing entry when the skill is already a user-added skill", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    const existingUserSkill: SeededProjectAgentSkill = {
      source: "clawhub", spec: "my-clawhub-skill", origin: "user", status: "error", updatedAt: Date.now() - 10_000, errorMessage: "previously failed",
    };
    await seedProjectAgent(t, { workspaceKey: WS_KEY, skills: [existingUserSkill] });

    waitForRuntimeEvent
      .mockResolvedValueOnce(userSkillWorkspaceListResult())
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_OPENCLAW_EXEC_RESULT,
        payload: { ok: true, commandId: "cmd-skill-install", instanceId: INSTANCE_ID, data: { output: "" } },
      });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.addAgentSkill, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      spec: "my-clawhub-skill",
    });

    expect(result.status).toBe("installed");
    expect(waitForRuntimeEvent).toHaveBeenCalledTimes(2);

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    // Exactly one entry — the stale error entry was replaced, not duplicated.
    expect(record?.skills).toHaveLength(1);
    expect(record?.skills?.[0]).toEqual(
      expect.objectContaining({ source: "clawhub", spec: "my-clawhub-skill", origin: "user", status: "installed" }),
    );
  });

  it("treats ClawHub's 'Already installed' error as success instead of failing reconciliation", async () => {
    // Regression: `clawhub install` refuses to reinstall a skill whose
    // directory already exists on disk without `--force`. This happens on
    // re-activation whenever the workspace still has the skill from a prior
    // install — reconciliation only needs the skill present, so this must
    // not fail the Agent activation.
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await seedProjectAgent(t, { workspaceKey: WS_KEY });

    waitForRuntimeEvent
      .mockResolvedValueOnce(userSkillWorkspaceListResult())
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_OPENCLAW_EXEC_RESULT,
        payload: {
          ok: false,
          commandId: "cmd-skill-install",
          instanceId: INSTANCE_ID,
          error: `Already installed: /home/node/.openclaw/${WS_KEY}/skills/my-clawhub-skill (use --force)`,
        },
      });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.addAgentSkill, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      spec: "my-clawhub-skill",
    });

    expect(result.status).toBe("installed");

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    expect(record?.skills?.[0]).toEqual(
      expect.objectContaining({ source: "clawhub", spec: "my-clawhub-skill", origin: "user", status: "installed" }),
    );
  });
});

describe("deactivateProjectAgent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("ACTIVATION_BROKER_TIMEOUT_MS", "5000");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(configuredStatusCheckResponse()));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("deactivate sets status: inactive and preserves workspaceKey and removes all MCP keys", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    // Seed an active agent
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        status: "active",
        workspaceKey: "ws-preserved",
        mcpServerKeys: SEO_MCP_KEYS,
        createdAt: now,
        updatedAt: now,
      });
    });

    // Each MCP key has ref-count 1 → all should be removed
    waitForRuntimeEvent.mockResolvedValueOnce({
      status: 200, found: true, type: RUNTIME_MCP_SERVERS_REMOVE_RESULT,
      payload: { ok: true, commandId: "cmd-r1", instanceId: INSTANCE_ID, data: { removedKeys: SEO_MCP_KEYS } },
    }).mockResolvedValueOnce({
      status: 200, found: true, type: RUNTIME_OPENCLAW_EXEC_RESULT,
      payload: { ok: true, commandId: "cmd-delete-agent", instanceId: INSTANCE_ID, data: { output: JSON.stringify({ name: TEMPLATE_ID }) } },
    });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.deactivateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });

    expect(result.status).toBe("inactive");

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    expect(record?.status).toBe("inactive");
    expect(record?.workspaceKey).toBe("ws-preserved");

    const commands = await t.run(async (ctx) => {
      return await ctx.db.query("commands").collect();
    });
    expect(commands.map((command) => command.type)).toEqual([
      RUNTIME_MCP_SERVERS_REMOVE,
      RUNTIME_OPENCLAW_EXEC,
    ]);
    expect(commands[1].payload).toEqual({
      commandText: "openclaw agents delete opengroow--seo",
    });
  });

  it("deactivation logs native agent delete failure and still marks the agent inactive", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        status: "active",
        workspaceKey: "ws-preserved",
        mcpServerKeys: [],
        createdAt: now,
        updatedAt: now,
      });
    });

    waitForRuntimeEvent.mockResolvedValueOnce({
      status: 200, found: true, type: RUNTIME_OPENCLAW_EXEC_RESULT,
      payload: { ok: false, commandId: "cmd-delete-agent", instanceId: INSTANCE_ID, error: "Agent not found", data: { output: "" } },
    });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.deactivateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });

    expect(result.status).toBe("inactive");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("OpenClaw agent delete failed"));

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    expect(record?.status).toBe("inactive");
    warn.mockRestore();
  });

  it("returns Forbidden when deactivating an agent on another user's instance", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t, TEST_USER.tokenIdentifier);

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        status: "active",
        workspaceKey: "ws-forbidden",
        mcpServerKeys: SEO_MCP_KEYS,
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await t.withIdentity(OTHER_USER).action(api.project_agents_node.deactivateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });

    expect(result).toEqual({ status: "error", errorMessage: "Forbidden" });
    expect(waitForRuntimeEvent).not.toHaveBeenCalled();

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    expect(record?.status).toBe("active");
  });

  it("shared MCP key is NOT removed when the first of two active agents is deactivated", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    const SHARED_KEY = "article-mcp";
    const TEMPLATE_B = "seo-b";

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        status: "active",
        workspaceKey: "ws-a",
        mcpServerKeys: [SHARED_KEY],
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_B,
        status: "active",
        workspaceKey: "ws-b",
        mcpServerKeys: [SHARED_KEY],
        createdAt: now,
        updatedAt: now,
      });
    });

    waitForRuntimeEvent.mockResolvedValueOnce({
      status: 200, found: true, type: RUNTIME_OPENCLAW_EXEC_RESULT,
      payload: { ok: true, commandId: "cmd-delete-agent", instanceId: INSTANCE_ID, data: { output: JSON.stringify({ name: TEMPLATE_ID }) } },
    });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.deactivateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });

    expect(result.status).toBe("inactive");
    expect(waitForRuntimeEvent).toHaveBeenCalledTimes(1);

    const commands = await t.run(async (ctx) => {
      return await ctx.db.query("commands").collect();
    });
    expect(commands.map((command) => command.type)).toEqual([RUNTIME_OPENCLAW_EXEC]);
    expect(commands[0].payload).toEqual({
      commandText: "openclaw agents delete opengroow--seo",
    });
  });

  it("shared MCP key IS removed when the last agent referencing it is deactivated", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    const SHARED_KEY = "article-mcp";
    const TEMPLATE_B = "seo-b";

    await t.run(async (ctx) => {
      const now = Date.now();
      // Agent A already inactive (was first to deactivate)
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        status: "inactive",
        workspaceKey: "ws-a",
        mcpServerKeys: [SHARED_KEY],
        createdAt: now,
        updatedAt: now,
      });
      // Agent B still active — last one referencing SHARED_KEY
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_B,
        status: "active",
        workspaceKey: "ws-b",
        mcpServerKeys: [SHARED_KEY],
        createdAt: now,
        updatedAt: now,
      });
    });

    waitForRuntimeEvent.mockResolvedValueOnce({
      status: 200, found: true, type: RUNTIME_MCP_SERVERS_REMOVE_RESULT,
      payload: { ok: true, commandId: "cmd-r2", instanceId: INSTANCE_ID, data: { removedKeys: [SHARED_KEY] } },
    }).mockResolvedValueOnce({
      status: 200, found: true, type: RUNTIME_OPENCLAW_EXEC_RESULT,
      payload: { ok: true, commandId: "cmd-delete-agent-b", instanceId: INSTANCE_ID, data: { output: JSON.stringify({ name: TEMPLATE_B }) } },
    });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.deactivateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_B,
    });

    expect(result.status).toBe("inactive");
    expect(waitForRuntimeEvent).toHaveBeenCalledTimes(2);

    const commands = await t.run(async (ctx) => {
      const commands = await ctx.db.query("commands").collect();
      return commands;
    });
    const removeCommand = commands.find((c) => c.type === RUNTIME_MCP_SERVERS_REMOVE);
    expect(removeCommand).toBeDefined();
    expect(removeCommand?.payload.keys).toEqual([SHARED_KEY]);
    expect(commands.map((command) => command.type)).toEqual([
      RUNTIME_MCP_SERVERS_REMOVE,
      RUNTIME_OPENCLAW_EXEC,
    ]);
    expect(commands[1].payload).toEqual({
      commandText: "openclaw agents delete seo-b",
    });
  });

  it("returns error when agent does not exist", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.deactivateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: "nonexistent-template",
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.errorMessage).toBeTypeOf("string");
      expect(result.errorMessage.length).toBeGreaterThan(0);
    }
    expect(waitForRuntimeEvent).not.toHaveBeenCalled();
  });

  it("activate then deactivate: full chain sets status: inactive and preserves workspaceKey", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        payload: { ok: true, commandId: "cmd-1", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-full", label: TEMPLATE_ID, absolutePath: "/home/node/.openclaw/workspace-ws-full" } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_MCP_SERVERS_MERGE_RESULT,
        payload: { ok: true, commandId: "cmd-4", instanceId: INSTANCE_ID, data: { mergedKeys: SEO_MCP_KEYS } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-agents-add", instanceId: INSTANCE_ID, data: { agentId: TEMPLATE_ID, registered: true, configured: false } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-full");
    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
        payload: { ok: true, commandId: "cmd-3", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-full", filePath: "AGENTS.md" } },
      })
      .mockResolvedValueOnce(fileWriteResult("ws-full", "create_article.md"))
      .mockResolvedValueOnce(fileWriteResult("ws-full", "internal_linking.md"))
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_MCP_SERVERS_REMOVE_RESULT,
        payload: { ok: true, commandId: "cmd-5", instanceId: INSTANCE_ID, data: { removedKeys: SEO_MCP_KEYS } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_OPENCLAW_EXEC_RESULT,
        payload: { ok: true, commandId: "cmd-delete-agent", instanceId: INSTANCE_ID, data: { output: JSON.stringify({ agentId: TEMPLATE_ID }) } },
      });

    const activateResult = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: DEFAULT_SEO_USER_CONFIG,
    });
    expect(activateResult.status).toBe("active");
    const workspaceKey = activateResult.status === "active" ? activateResult.workspaceKey : null;

    const deactivateResult = await t.withIdentity(TEST_USER).action(api.project_agents_node.deactivateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    expect(deactivateResult.status).toBe("inactive");

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    expect(record?.status).toBe("inactive");
    expect(record?.workspaceKey).toBe(workspaceKey);
  });

  it("deactivation refused when one run is dispatching", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await seedRun(t, { instanceId: INSTANCE_ID, templateId: TEMPLATE_ID, status: "dispatching" });

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        status: "active",
        workspaceKey: "ws-guard",
        mcpServerKeys: [],
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.deactivateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });

    expect(result).toEqual({ status: "error", errorMessage: "Cannot deactivate: 1 run(s) still active" });
    expect(waitForRuntimeEvent).not.toHaveBeenCalled();
  });

  it("deactivation refused when one run is pending (dispatcher could claim it)", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await seedRun(t, { instanceId: INSTANCE_ID, templateId: TEMPLATE_ID, status: "pending" });

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        status: "active",
        workspaceKey: "ws-guard-pending",
        mcpServerKeys: [],
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.deactivateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });

    expect(result).toEqual({ status: "error", errorMessage: "Cannot deactivate: 1 run(s) still active" });
    expect(waitForRuntimeEvent).not.toHaveBeenCalled();
  });

  it("deactivation refused when one run is running", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await seedRun(t, { instanceId: INSTANCE_ID, templateId: TEMPLATE_ID, status: "running" });

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        status: "active",
        workspaceKey: "ws-guard-running",
        mcpServerKeys: [],
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.deactivateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });

    expect(result).toEqual({ status: "error", errorMessage: "Cannot deactivate: 1 run(s) still active" });
    expect(waitForRuntimeEvent).not.toHaveBeenCalled();
  });

  it("deactivation refused when several runs are active — message includes correct count", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await seedRun(t, { instanceId: INSTANCE_ID, templateId: TEMPLATE_ID, status: "dispatching" });
    await seedRun(t, { instanceId: INSTANCE_ID, templateId: TEMPLATE_ID, status: "running" });
    await seedRun(t, { instanceId: INSTANCE_ID, templateId: TEMPLATE_ID, status: "dispatching" });

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        status: "active",
        workspaceKey: "ws-guard-multi",
        mcpServerKeys: [],
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.deactivateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });

    expect(result).toEqual({ status: "error", errorMessage: "Cannot deactivate: 3 run(s) still active" });
    expect(waitForRuntimeEvent).not.toHaveBeenCalled();
  });

  it("deactivation allowed when only completed/failed runs exist for same (instanceId, templateId)", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await seedRun(t, { instanceId: INSTANCE_ID, templateId: TEMPLATE_ID, status: "completed" });
    await seedRun(t, { instanceId: INSTANCE_ID, templateId: TEMPLATE_ID, status: "failed" });

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        status: "active",
        workspaceKey: "ws-terminal",
        mcpServerKeys: [],
        createdAt: now,
        updatedAt: now,
      });
    });

    waitForRuntimeEvent.mockResolvedValueOnce({
      status: 200, found: true, type: RUNTIME_OPENCLAW_EXEC_RESULT,
      payload: { ok: true, commandId: "cmd-del", instanceId: INSTANCE_ID, data: { output: JSON.stringify({ name: TEMPLATE_ID }) } },
    });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.deactivateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });

    expect(result.status).toBe("inactive");
  });

  it("deactivation allowed when active runs exist for a different template on the same instance", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await seedRun(t, { instanceId: INSTANCE_ID, templateId: "other-template", status: "running" });

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        status: "active",
        workspaceKey: "ws-other-template",
        mcpServerKeys: [],
        createdAt: now,
        updatedAt: now,
      });
    });

    waitForRuntimeEvent.mockResolvedValueOnce({
      status: 200, found: true, type: RUNTIME_OPENCLAW_EXEC_RESULT,
      payload: { ok: true, commandId: "cmd-del-2", instanceId: INSTANCE_ID, data: { output: JSON.stringify({ name: TEMPLATE_ID }) } },
    });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.deactivateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });

    expect(result.status).toBe("inactive");
  });

  it("deactivating an already-inactive agent is a no-op: stays inactive, no runtime call", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        status: "inactive",
        workspaceKey: "ws-idempotent",
        mcpServerKeys: SEO_MCP_KEYS,
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.deactivateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });

    expect(result.status).toBe("inactive");
    expect(waitForRuntimeEvent).not.toHaveBeenCalled();

    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    expect(record?.status).toBe("inactive");
    expect(record?.workspaceKey).toBe("ws-idempotent");
  });
});

describe("listByInstance", () => {
  it("returns an empty array when no agents exist for the instance", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    const result = await t.withIdentity(TEST_USER).query(api.project_agents.listByInstance, {
      instanceId: INSTANCE_ID,
    });

    expect(result).toEqual([]);
  });

  it("returns only agents belonging to the given instance", async () => {
    const t = convexTest(schema, modules);
    const OTHER_INSTANCE = "openclaw-instance-other";
    await seedInstance(t);

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: "@opengroow/seo",
        status: "active",
        workspaceKey: "ws-seo",
        mcpServerKeys: ["article-mcp"],
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("projectAgents", {
        instanceId: OTHER_INSTANCE,
        templateId: "@opengroow/seo",
        status: "active",
        workspaceKey: "ws-other",
        mcpServerKeys: [],
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await t.withIdentity(TEST_USER).query(api.project_agents.listByInstance, {
      instanceId: INSTANCE_ID,
    });

    expect(result).toHaveLength(1);
    expect(result[0].templateId).toBe("@opengroow/seo");
    expect(result[0].instanceId).toBe(INSTANCE_ID);
  });

  it("returns agents in all statuses", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    await t.run(async (ctx) => {
      const now = Date.now();
      for (const [templateId, status] of [
        ["seo", "active"],
        ["seo-b", "activating"],
        ["seo-c", "error"],
        ["seo-d", "inactive"],
      ] as const) {
        await ctx.db.insert("projectAgents", {
          instanceId: INSTANCE_ID,
          templateId,
          status,
          mcpServerKeys: [],
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    const result = await t.withIdentity(TEST_USER).query(api.project_agents.listByInstance, {
      instanceId: INSTANCE_ID,
    });

    expect(result).toHaveLength(4);
    const statuses = result.map((r) => r.status).sort();
    expect(statuses).toEqual(["activating", "active", "error", "inactive"]);
  });

  it("throws when no authenticated user is present", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.query(api.project_agents.listByInstance, { instanceId: INSTANCE_ID }),
    ).rejects.toThrow(/Authentication required/);
  });

  it("returns an empty list when reading another user's instance agents", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t, TEST_USER.tokenIdentifier);

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: "@opengroow/seo",
        status: "active",
        workspaceKey: "ws-seo",
        mcpServerKeys: ["article-mcp"],
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await t.withIdentity(OTHER_USER).query(api.project_agents.listByInstance, {
      instanceId: INSTANCE_ID,
    });

    expect(result).toEqual([]);
  });

  it("returns agent records for a unique unowned local instance", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t, null);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: "@opengroow/seo",
        status: "active",
        workspaceKey: "ws-seo",
        mcpServerKeys: ["article-mcp"],
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await t.withIdentity(TEST_USER).query(api.project_agents.listByInstance, {
      instanceId: INSTANCE_ID,
    });

    expect(result).toHaveLength(1);
    expect(result[0].templateId).toBe("@opengroow/seo");
  });
});

describe("reconfigureProjectAgent", () => {
  const SEO_PROJECT_ID = "seo-proj-uuid";
  // EXISTING_CONFIG uses the flat shape (ADR-021). Configs are written flat at
  // activation time; the dashboard reads flat keys directly.
  const EXISTING_CONFIG = {
    seoProjectId: SEO_PROJECT_ID,
    apiKey: "old-api-key",
    githubOwner: "old-org",
    githubRepo: "old-site",
    githubContentBase: "content/blog",
    githubCoverBase: "public/covers",
    githubToken: "ghp_old",
  };
  const UPDATE_USER_CONFIG = {
    apiKey: "new-api-key",
    context: "Updated product description",
    githubOwner: "new-org",
    githubRepo: "new-site",
    githubContentBase: "content/articles",
    githubCoverBase: "public/images",
    githubPublicBase: "public",
    githubToken: "ghp_new",
    githubBranch: "main",
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("ACTIVATION_BROKER_TIMEOUT_MS", "5000");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("throws when no authenticated user is present", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    await expect(
      t.action(api.project_agents_node.reconfigureProjectAgent, {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        userConfig: UPDATE_USER_CONFIG,
      }),
    ).rejects.toThrow(/Authentication required/);
  });

  it("returns Forbidden when updating another user's instance", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t, TEST_USER.tokenIdentifier);
    await seedProjectAgent(t, { config: EXISTING_CONFIG });

    const result = await t.withIdentity(OTHER_USER).action(api.project_agents_node.reconfigureProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: UPDATE_USER_CONFIG,
    });

    expect(result).toEqual({ status: "error", errorMessage: "Forbidden" });
  });

  // Config Completeness (issue #320, ADR-034): seo/video no longer declare a
  // reconfiguration effect or reconfigurable: true — apiKey is their sole,
  // immutable requirement, so there is nothing left to reconfigure. Generic
  // ownership/not-found/not-active guards are exercised against
  // social-engagement instead, which still supports config-only reconfigure.
  const SOCIAL_TEMPLATE_ID = "@opengroow/engagement";
  const SOCIAL_EXISTING_CONFIG = {
    accountHandleInstagram: "@brand",
    accountHandleTiktok: "@brand.tt",
    accountBio: "Old bio",
    likeWhen: "street photography",
  };
  const SOCIAL_UPDATE_USER_CONFIG = {
    accountHandleInstagram: "@brand",
    accountHandleTiktok: "@brand.tt",
    accountBio: "New bio",
    likeWhen: "street photography, film photography",
  };

  it("returns error when the Template has no reconfiguration effect and is not config-only reconfigurable", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t, { config: EXISTING_CONFIG });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.reconfigureProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: UPDATE_USER_CONFIG,
    });

    expect(result).toEqual({ status: "error", errorMessage: `Template ${TEMPLATE_ID} is not reconfigurable` });
  });

  it("returns error when agent does not exist", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.reconfigureProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: SOCIAL_TEMPLATE_ID,
      userConfig: SOCIAL_UPDATE_USER_CONFIG,
    });

    expect(result).toEqual({ status: "error", errorMessage: "Agent not found" });
  });

  it("returns error when agent is not active", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t, { templateId: SOCIAL_TEMPLATE_ID, status: "inactive", config: SOCIAL_EXISTING_CONFIG });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.reconfigureProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: SOCIAL_TEMPLATE_ID,
      userConfig: SOCIAL_UPDATE_USER_CONFIG,
    });

    expect(result).toEqual({ status: "error", errorMessage: "Agent must be active to reconfigure" });
  });

  it("config-only reconfigure (social-engagement) merges the submitted userConfig over the stored config", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t, { templateId: SOCIAL_TEMPLATE_ID, config: SOCIAL_EXISTING_CONFIG });
    (await getWaitForRuntimeEvent()).mockResolvedValueOnce(agentCredentialResult());

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.reconfigureProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: SOCIAL_TEMPLATE_ID,
      userConfig: SOCIAL_UPDATE_USER_CONFIG,
    });

    expect(result).toEqual({ status: "updated" });

    const agent = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: SOCIAL_TEMPLATE_ID,
    });
    expect(agent?.config).toEqual(SOCIAL_UPDATE_USER_CONFIG);
  });

  it("delivers the changed requirement marked deliveredToInstance to the Instance (issue #658)", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t, { templateId: SOCIAL_TEMPLATE_ID, config: { ...SOCIAL_EXISTING_CONFIG, classifierApiKey: "old-key" } });
    (await getWaitForRuntimeEvent()).mockResolvedValueOnce(agentCredentialResult());

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.reconfigureProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: SOCIAL_TEMPLATE_ID,
      userConfig: { ...SOCIAL_UPDATE_USER_CONFIG, classifierApiKey: "new-key" },
    });

    expect(result).toEqual({ status: "updated" });
    const commands = await t.run(async (ctx) => ctx.db.query("commands").collect());
    expect(commands.find((c) => c.type === "runtime.agent-credential.set")?.payload).toEqual({
      agentId: "opengroow--engagement",
      apiKey: "new-key",
    });
  });

  it("returns the delivery failure and keeps the stored config when delivery fails (issue #658)", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const storedConfig = { ...SOCIAL_EXISTING_CONFIG, classifierApiKey: "old-key" };
    await seedProjectAgent(t, { templateId: SOCIAL_TEMPLATE_ID, config: storedConfig });
    (await getWaitForRuntimeEvent()).mockResolvedValueOnce({
      status: 200, found: true, type: RUNTIME_AGENT_CREDENTIAL_SET_RESULT,
      payload: { ok: false, error: "credential storage failed", commandId: "cmd-1", instanceId: INSTANCE_ID, data: { agentId: SOCIAL_TEMPLATE_ID } },
    });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.reconfigureProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: SOCIAL_TEMPLATE_ID,
      userConfig: { ...SOCIAL_UPDATE_USER_CONFIG, classifierApiKey: "new-key" },
    });

    expect(result).toEqual({ status: "error", errorMessage: "credential storage failed" });
    const agent = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: SOCIAL_TEMPLATE_ID,
    });
    expect(agent?.config).toEqual(storedConfig);
  });
});

describe("OpenClaw agent id derived from the Template id (issue #664)", () => {
  const SCOPED_ID = "@opengroow/hello";
  const SLUG = "opengroow--hello";

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("ACTIVATION_BROKER_TIMEOUT_MS", "5000");
    vi.stubEnv("OPENGROOW_ENABLE_DEMO_AGENTS", "1");
    installTemplateRegistry([INSTANCE_ID], [fixtureTemplate(SCOPED_ID)]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function registerResult() {
    return {
      status: 200 as const, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
      payload: { ok: true, commandId: "cmd-agents-add", instanceId: INSTANCE_ID, data: { agentId: SLUG, registered: true, configured: false } },
    };
  }

  it("activation registers a scoped Template under its slug and stores that slug as the OpenClaw agent name", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        payload: { ok: true, commandId: "cmd-1", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-scoped", label: SCOPED_ID, absolutePath: "/home/node/.openclaw/workspace-ws-scoped" } },
      })
      .mockResolvedValueOnce(registerResult());
    addFileDeleteMocks(waitForRuntimeEvent, "ws-scoped");
    waitForRuntimeEvent.mockResolvedValueOnce(fileWriteResult("ws-scoped", "AGENTS.md"));

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: SCOPED_ID,
    });

    expect(result.status).toBe("active");
    const commands = await t.run(async (ctx) => ctx.db.query("commands").collect());
    const register = commands.find((c) => c.type === RUNTIME_AGENT_REGISTER_AND_CONFIGURE);
    expect(register?.payload).toMatchObject({
      agentId: SLUG,
      registerCommandText: `openclaw agents add ${SLUG} --workspace /home/node/.openclaw/workspace-ws-scoped --non-interactive --json`,
    });
    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, { instanceId: INSTANCE_ID, templateId: SCOPED_ID });
    expect(record?.openclawAgentName).toBe(SLUG);
  });

  it("refresh migrates an Agent still registered under its raw Template id: same workspace, new slug, old agent left untouched", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID, templateId: SCOPED_ID, status: "active", workspaceKey: "ws-legacy",
        openclawAgentName: "hello", mcpServerKeys: [], createdAt: now, updatedAt: now,
      });
    });
    waitForRuntimeEvent
      .mockResolvedValueOnce(workspaceListResult("ws-legacy"))
      .mockResolvedValueOnce(registerResult());
    addFileDeleteMocks(waitForRuntimeEvent, "ws-legacy");
    waitForRuntimeEvent.mockResolvedValueOnce(fileWriteResult("ws-legacy", "AGENTS.md"));

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.refreshProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: SCOPED_ID,
    });

    expect(result).toEqual({ status: "refreshed", workspaceKey: "ws-legacy" });
    const commands = await t.run(async (ctx) => ctx.db.query("commands").collect());
    expect(commands.find((c) => c.type === RUNTIME_AGENT_REGISTER_AND_CONFIGURE)?.payload).toMatchObject({
      registerCommandText: `openclaw agents add ${SLUG} --workspace /home/node/.openclaw/workspace-ws-legacy --non-interactive --json`,
    });
    // Nothing is deleted or moved: the workspace (and the old agent) stay as they were.
    expect(commands.some((c) => c.type === RUNTIME_OPENCLAW_EXEC)).toBe(false);
    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, { instanceId: INSTANCE_ID, templateId: SCOPED_ID });
    expect(record?.openclawAgentName).toBe(SLUG);
    expect(record?.workspaceKey).toBe("ws-legacy");
  });

  it("deactivation deletes the agent the row is registered under", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID, templateId: SCOPED_ID, status: "active", workspaceKey: "ws-del",
        openclawAgentName: SLUG, mcpServerKeys: [], createdAt: now, updatedAt: now,
      });
    });
    waitForRuntimeEvent.mockResolvedValueOnce({
      status: 200, found: true, type: RUNTIME_OPENCLAW_EXEC_RESULT,
      payload: { ok: true, commandId: "cmd-delete-agent", instanceId: INSTANCE_ID, data: { output: "{}" } },
    });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.deactivateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: SCOPED_ID,
    });

    expect(result.status).toBe("inactive");
    const commands = await t.run(async (ctx) => ctx.db.query("commands").collect());
    expect(commands.map((c) => c.payload)).toEqual([{ commandText: `openclaw agents delete ${SLUG}` }]);
  });
});

describe("addProjectAgent (#655)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("ACTIVATION_BROKER_TIMEOUT_MS", "5000");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(configuredStatusCheckResponse()));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("installs and activates the Agent in one call", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);

    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        payload: { ok: true, commandId: "cmd-1", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-generated", label: TEMPLATE_ID, absolutePath: WORKSPACE_ABSOLUTE_PATH } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_MCP_SERVERS_MERGE_RESULT,
        payload: { ok: true, commandId: "cmd-2", instanceId: INSTANCE_ID, data: { mergedKeys: SEO_MCP_KEYS } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-agents-add", instanceId: INSTANCE_ID, data: { agentId: TEMPLATE_ID, registered: true, configured: false } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-generated");
    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
        payload: { ok: true, commandId: "cmd-agents-md", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-generated", filePath: "AGENTS.md" } },
      });
    addSeoMissionInstructionWriteMocks(waitForRuntimeEvent, "ws-generated");

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.addProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: DEFAULT_SEO_USER_CONFIG,
    });

    expect(result.status).toBe("active");
    const record = await t.withIdentity(TEST_USER).query(api.project_agents.get, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
    });
    expect(record?.status).toBe("active");
  });

  it("refuses a second Agent of a Template the Project already has, whatever its status", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID, templateId: TEMPLATE_ID, status: "inactive", mcpServerKeys: [],
        createdAt: 1, updatedAt: 1,
      });
    });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.addProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      userConfig: DEFAULT_SEO_USER_CONFIG,
    });

    expect(result).toEqual({
      status: "error",
      errorMessage: `This Project already has an Agent of Template ${TEMPLATE_ID}`,
    });
    expect(waitForRuntimeEvent).not.toHaveBeenCalled();
    const agents = await t.run(async (ctx) => ctx.db.query("projectAgents").collect());
    expect(agents).toHaveLength(1);
    expect(agents[0]?.status).toBe("inactive");
  });

  it("claims a new Agent's record only once, so concurrent adds cannot both provision", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const args = { instanceId: INSTANCE_ID, templateId: TEMPLATE_ID };

    const [first, second] = await Promise.all([
      t.mutation(internal.project_agents.claimNew, args),
      t.mutation(internal.project_agents.claimNew, args),
    ]);

    expect([first, second].sort()).toEqual([false, true]);
    const agents = await t.run(async (ctx) => ctx.db.query("projectAgents").collect());
    expect(agents).toHaveLength(1);
    expect(agents[0]?.status).toBe("activating");
  });
});

describe("Requirement delivered to the Instance (issue #658)", () => {
  const DELIVERING_ID = "delivering-agent";
  const delivering = (extra: Partial<ReturnType<typeof fixtureTemplate>["manifest"]> = {}) =>
    fixtureTemplate(DELIVERING_ID, {
      requirements: [{ key: "secret", type: "password", label: "Secret", required: true, deliveredToInstance: true }],
      ...extra,
    });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("ACTIVATION_BROKER_TIMEOUT_MS", "5000");
    vi.stubEnv("OPENGROOW_ENABLE_DEMO_AGENTS", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // `delivery`: the Instance's answer to the delivery command; omitted when
  // nothing is expected to be delivered.
  function arrangeActivation(
    waitForRuntimeEvent: Awaited<ReturnType<typeof getWaitForRuntimeEvent>>,
    delivery?: Record<string, unknown>,
  ) {
    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        payload: { ok: true, commandId: "cmd-1", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-deliver", label: DELIVERING_ID, absolutePath: "/home/node/.openclaw/workspace-ws-deliver" } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-2", instanceId: INSTANCE_ID, data: { agentId: DELIVERING_ID, registered: true, configured: false } },
      });
    if (delivery) waitForRuntimeEvent.mockResolvedValueOnce(delivery);
    addFileDeleteMocks(waitForRuntimeEvent, "ws-deliver");
    waitForRuntimeEvent.mockResolvedValueOnce(fileWriteResult("ws-deliver", "AGENTS.md"));
  }

  it("delivers the marked requirement's value at activation, whatever the Template id", async () => {
    installTemplateRegistry([INSTANCE_ID], [delivering()]);
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    arrangeActivation(waitForRuntimeEvent, agentCredentialResult(DELIVERING_ID));

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: DELIVERING_ID,
      userConfig: { secret: "  s3cret  " },
    });

    expect(result.status).toBe("active");
    const commands = await t.run(async (ctx) => ctx.db.query("commands").collect());
    expect(commands.find((c) => c.type === "runtime.agent-credential.set")?.payload).toEqual({
      agentId: DELIVERING_ID,
      apiKey: "s3cret",
    });
  });

  it("delivers nothing when no requirement is marked", async () => {
    installTemplateRegistry([INSTANCE_ID], [fixtureTemplate(DELIVERING_ID, {
      requirements: [{ key: "secret", type: "password", label: "Secret", required: true }],
    })]);
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    arrangeActivation(waitForRuntimeEvent);

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: DELIVERING_ID,
      userConfig: { secret: "s3cret" },
    });

    expect(result.status).toBe("active");
    const commands = await t.run(async (ctx) => ctx.db.query("commands").collect());
    expect(commands.some((c) => c.type === "runtime.agent-credential.set")).toBe(false);
  });

  it("surfaces a delivery failure as the Agent's activation error", async () => {
    installTemplateRegistry([INSTANCE_ID], [delivering()]);
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    arrangeActivation(waitForRuntimeEvent, {
      status: 200, found: true, type: RUNTIME_AGENT_CREDENTIAL_SET_RESULT,
      payload: { ok: false, error: "credential storage failed", commandId: "cmd-3", instanceId: INSTANCE_ID, data: { agentId: DELIVERING_ID } },
    });

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: DELIVERING_ID,
      userConfig: { secret: "s3cret" },
    });

    expect(result).toMatchObject({ status: "error" });
    expect(JSON.stringify(result)).toContain("credential storage failed");
  });
});

describe("machine prerequisites never block activation (issue #662)", () => {
  const ID = "@opengroow/hello";

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("ACTIVATION_BROKER_TIMEOUT_MS", "5000");
    vi.stubEnv("OPENGROOW_ENABLE_DEMO_AGENTS", "1");
    installTemplateRegistry(
      [INSTANCE_ID],
      [
        fixtureTemplate(ID, {
          machinePrerequisites: [{ name: "Tool A", minVersion: "9.9.9", instructionsUrl: "https://example.com/a" }],
        }),
      ],
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("activates a Template that declares an unmet prerequisite: activation proceeds to active", async () => {
    const t = convexTest(schema, modules);
    const waitForRuntimeEvent = await getWaitForRuntimeEvent();
    await seedInstance(t);
    waitForRuntimeEvent
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_WORKSPACE_CREATE_RESULT,
        payload: { ok: true, commandId: "cmd-1", instanceId: INSTANCE_ID, data: { workspaceKey: "ws-prereq", label: ID, absolutePath: "/home/node/.openclaw/workspace-ws-prereq" } },
      })
      .mockResolvedValueOnce({
        status: 200, found: true, type: RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
        payload: { ok: true, commandId: "cmd-2", instanceId: INSTANCE_ID, data: { agentId: "opengroow--hello", registered: true, configured: false } },
      });
    addFileDeleteMocks(waitForRuntimeEvent, "ws-prereq");
    waitForRuntimeEvent.mockResolvedValueOnce(fileWriteResult("ws-prereq", "AGENTS.md"));

    const result = await t.withIdentity(TEST_USER).action(api.project_agents_node.activateProjectAgent, {
      instanceId: INSTANCE_ID,
      templateId: ID,
    });

    expect(result.status).toBe("active");
  });
});
