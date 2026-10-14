import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../_generated/api";
import schema from "../schema";
import {
  RUNTIME_OPENCLAW_EXEC,
  RUNTIME_OPENCLAW_EXEC_RESULT,
  RUNTIME_WORKSPACE_FILE_READ,
  RUNTIME_WORKSPACE_FILE_READ_RESULT,
  RUNTIME_WORKSPACE_FILE_WRITE,
  buildRuntimeResultEventId,
} from "@opengroow/protocol";
import type { Id } from "../_generated/dataModel";
import { MAX_RETRYABLE_JOB_FAILURES } from "../mission_dispatcher/external_job_polling";
import { computeRunMaxMs, normalizeExternalJobPollPayload } from "../mission_dispatcher_node";
import type { AgentTemplate } from "@opengroow/agent-templates";
import { setTemplateRegistryForTests } from "../template_registry";
import { officialFixtureTemplate, fixtureTemplate, inMemoryRegistry, useTemplateRegistry } from "./helpers/template_registry.helpers";

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
  "../runs.ts": () => import("../runs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../project_agents_node.ts": () => import("../project_agents_node.js"),
  "../runtime_commands_node.ts": () => import("../runtime_commands_node.js"),
  "../mission_dispatcher.ts": () => import("../mission_dispatcher.js"),
  "../mission_dispatcher_node.ts": () => import("../mission_dispatcher_node.js"),
};

type FileToWrite = { filePath: string; content: string };

/**
 * context.md and the run file now travel on the exec command itself
 * (`filesToWrite`) instead of being separate write commands, so the Runtime
 * Worker writes them, in order, right before starting the agent.
 */
function execFilesToWrite(command: { payload: unknown }): FileToWrite[] {
  return ((command.payload as { filesToWrite?: FileToWrite[] }).filesToWrite ?? []);
}

function findExecFile(
  commands: Array<{ type: string; payload: unknown }>,
  filePath: string,
): FileToWrite | undefined {
  return commands
    .filter((command) => command.type === RUNTIME_OPENCLAW_EXEC)
    .flatMap(execFilesToWrite)
    .find((file) => file.filePath === filePath);
}

const INSTANCE_ID = "openclaw-instance-disp";
const TEMPLATE_ID = "@opengroow/seo";
const OPENCLAW_AGENT = "seo";
const WORKSPACE_KEY = "ws-seo";
const OWNER_ID = "owner-disp";

async function seedActiveProjectAgentAndPendingRun(t: ReturnType<typeof convexTest>): Promise<{
  missionId: Id<"missions">;
  runId: Id<"runs">;
}> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("projectAgents", {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      workspaceKey: WORKSPACE_KEY,
      openclawAgentName: OPENCLAW_AGENT,
      status: "active",
      mcpServerKeys: [],
      config: { seoProjectId: "proj-disp", apiKey: "key-disp" },
      createdAt: now,
      updatedAt: now,
    });
    const missionId = await ctx.db.insert("missions", {
      ownerId: OWNER_ID,
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: { topic: "Octopus" },
      status: "todo",
      createdAt: now,
      updatedAt: now,
    });
    const runId = await ctx.db.insert("runs", {
      missionId,
      ownerId: OWNER_ID,
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      agentName: OPENCLAW_AGENT,
      sessionKey: `mega-mission-${missionId}`,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    return { missionId, runId };
  });
}

async function seedPendingMissionRun(t: ReturnType<typeof convexTest>): Promise<{
  missionId: Id<"missions">;
  runId: Id<"runs">;
}> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const missionId = await ctx.db.insert("missions", {
      ownerId: OWNER_ID,
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: { topic: "Octopus" },
      status: "todo",
      createdAt: now,
      updatedAt: now,
    });
    const runId = await ctx.db.insert("runs", {
      missionId,
      ownerId: OWNER_ID,
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      agentName: OPENCLAW_AGENT,
      sessionKey: `mega-mission-${missionId}`,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    return { missionId, runId };
  });
}

async function seedPendingRunForInstance(
  t: ReturnType<typeof convexTest>,
  instanceId: string,
  templateId: string,
  createdAt: number,
): Promise<{ missionId: Id<"missions">; runId: Id<"runs"> }> {
  return await t.run(async (ctx) => {
    await ctx.db.insert("projectAgents", {
      instanceId,
      templateId,
      workspaceKey: `ws-${templateId}`,
      openclawAgentName: templateId,
      status: "active",
      mcpServerKeys: [],
      createdAt,
      updatedAt: createdAt,
    });
    const missionId = await ctx.db.insert("missions", {
      ownerId: OWNER_ID,
      instanceId,
      templateId,
      type: "create_article",
      payload: {},
      status: "todo",
      createdAt,
      updatedAt: createdAt,
    });
    const runId = await ctx.db.insert("runs", {
      missionId,
      ownerId: OWNER_ID,
      instanceId,
      templateId,
      agentName: templateId,
      sessionKey: `mega-mission-${missionId}`,
      status: "pending",
      createdAt,
      updatedAt: createdAt,
    });
    return { missionId, runId };
  });
}

const SOCIAL_INSTANCE_ID = "openclaw-instance-social";

/**
 * The generic engagement package declares no context provider. The
 * `platform-account` provider (a per-platform account handle resolved from the
 * Agent config) is exercised here by declaring it on the engage Mission type.
 */
function withPlatformAccountProvider(template: AgentTemplate): AgentTemplate {
  return {
    ...template,
    manifest: {
      ...template.manifest,
      requirements: [
        ...(template.manifest.requirements ?? []),
        {
          type: "group",
          label: "Account handles",
          fields: [
            { key: "accountHandleInstagram", type: "text", label: "Instagram handle", required: false },
            { key: "accountHandleTiktok", type: "text", label: "TikTok handle", required: false },
          ],
        },
      ],
      missionTypes: template.manifest.missionTypes?.map((missionType) =>
        missionType.type === "engage"
          ? {
              ...missionType,
              contextProviders: ["platform-account"],
              fields: [
                {
                  key: "platform",
                  label: "Platform",
                  type: "select",
                  required: true,
                  options: [
                    { value: "instagram", label: "Instagram" },
                    { value: "tiktok", label: "TikTok" },
                  ],
                },
              ],
            }
          : missionType,
      ),
    },
  };
}

// Every Mission lifecycle test below resolves Templates through the in-memory
// registry (Project = Instance id), not through the built-in registry.
useTemplateRegistry(
  [INSTANCE_ID, SOCIAL_INSTANCE_ID, "inst-hello-no-contract", "inst-video", "inst-seo-article"],
  ["@opengroow/seo", "@opengroow/hello", withPlatformAccountProvider(officialFixtureTemplate("@opengroow/engagement")), "@opengroow/video-demo"],
);
const SOCIAL_WORKSPACE_KEY = "ws-social";
const SOCIAL_AGENT = "engagement";

async function seedActiveProjectAgentAndPendingEngageRun(
  t: ReturnType<typeof convexTest>,
  opts: { payload?: Record<string, unknown> } = {},
): Promise<{
  missionId: Id<"missions">;
  runId: Id<"runs">;
}> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("projectAgents", {
      instanceId: SOCIAL_INSTANCE_ID,
      templateId: "@opengroow/engagement",
      workspaceKey: SOCIAL_WORKSPACE_KEY,
      openclawAgentName: SOCIAL_AGENT,
      status: "active",
      mcpServerKeys: [],
      config: {
        accountHandleInstagram: "@ig-handle",
        accountHandleTiktok: "@tt-handle",
        accountBio: "Street photography account",
        likeWhen: "Street photography, urban architecture",
      },
      createdAt: now,
      updatedAt: now,
    });
    const missionId = await ctx.db.insert("missions", {
      ownerId: OWNER_ID,
      instanceId: SOCIAL_INSTANCE_ID,
      templateId: "@opengroow/engagement",
      type: "engage",
      payload: opts.payload ?? { platform: "instagram", followLiked: true },
      status: "todo",
      createdAt: now,
      updatedAt: now,
    });
    const runId = await ctx.db.insert("runs", {
      missionId,
      ownerId: OWNER_ID,
      instanceId: SOCIAL_INSTANCE_ID,
      templateId: "@opengroow/engagement",
      agentName: SOCIAL_AGENT,
      sessionKey: `mega-mission-${missionId}`,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    return { missionId, runId };
  });
}

describe("mission_dispatcher_node.computeRunMaxMs", () => {
  const PROJECT = "project-run-max";
  const sessionTemplate = fixtureTemplate("fixture-session", {
    missionTypes: [
      { type: "engage", label: "Engage", payload: "{}", agentsMd: "engage.md", sessionDurationMs: { min: 60_000, max: 600_000 } },
      { type: "plain", label: "Plain", payload: "{}", agentsMd: "plain.md" },
    ],
  });
  const registry = inMemoryRegistry([PROJECT], [sessionTemplate]);
  const maxMs = (missionType: string, payload?: unknown, templateId = "fixture-session") =>
    computeRunMaxMs(registry, PROJECT, templateId, missionType, payload);

  it("falls back to the same generic MISSION_RUN_MAX_MS-derived deadline as non-session Mission types when the Mission payload has no override", async () => {
    // No more Template-level hardcoded default: with no payload override, a
    // session-bound Mission gets the exact same total deadline (900_000ms) as
    // any other, expressed as (MISSION_RUN_MAX_MS - margin) session budget + margin.
    expect(await maxMs("engage")).toBe(900_000);
  });

  it("falls back to the global MISSION_RUN_MAX_MS when no sessionDurationMs is declared", async () => {
    expect(await maxMs("plain")).toBe(900_000);
  });

  it("falls back to the global MISSION_RUN_MAX_MS for a Template the Project does not have", async () => {
    expect(await maxMs("engage", { sessionDurationMs: 300_000 }, "unknown")).toBe(900_000);
    expect(
      await computeRunMaxMs(registry, "other-project", "fixture-session", "engage", { sessionDurationMs: 300_000 }),
    ).toBe(900_000);
  });

  it("uses a valid sessionDurationMs override from the Mission payload instead of the generic default", async () => {
    expect(await maxMs("engage", { sessionDurationMs: 300_000 })).toBe(600_000);
  });

  it("ignores an invalid sessionDurationMs override (zero, negative, non-numeric) and falls back to the generic default", async () => {
    expect(await maxMs("engage", { sessionDurationMs: 0 })).toBe(900_000);
    expect(await maxMs("engage", { sessionDurationMs: -1 })).toBe(900_000);
    expect(await maxMs("engage", { sessionDurationMs: "300000" })).toBe(900_000);
    expect(await maxMs("engage", { sessionDurationMs: NaN })).toBe(900_000);
  });

  it("ignores a sessionDurationMs override on a Mission type with no declared sessionDurationMs", async () => {
    expect(await maxMs("plain", { sessionDurationMs: 300_000 })).toBe(900_000);
  });
});

describe("mission_dispatcher_node.normalizeExternalJobPollPayload (issue #455)", () => {
  const conventionalContract = { statusField: "status", outputIsRoot: undefined };

  it("passes through a conventional service's plain status/error/output shape unchanged", () => {
    const result = normalizeExternalJobPollPayload(
      { status: "completed", output: { articleId: "a1" } },
      conventionalContract,
    );
    expect(result).toEqual({ status: "completed", error: undefined, output: { articleId: "a1" } });
  });

  it("passes through a conventional service's plain string error unchanged", () => {
    const result = normalizeExternalJobPollPayload(
      { status: "failed", error: "over-length title" },
      conventionalContract,
    );
    expect(result.error).toBe("over-length title");
    expect(result.output).toBeUndefined();
  });

  it("falls back to status 'failed' when statusField is absent and success is false (analysis-mcp shape)", () => {
    const result = normalizeExternalJobPollPayload(
      { success: false, error: { code: "reel_unavailable", message: "The reel is no longer available" } },
      conventionalContract,
    );
    expect(result.status).toBe("failed");
  });

  it("returns the empty-string malformed-status signal when statusField is absent and there is no success:false", () => {
    const result = normalizeExternalJobPollPayload({ foo: "bar" }, conventionalContract);
    expect(result.status).toBe("");
  });

  it("folds an object error's message into `error` and its code into `output.errorCode`", () => {
    const result = normalizeExternalJobPollPayload(
      { success: false, error: { code: "reel_private", message: "The reel is private" } },
      conventionalContract,
    );
    expect(result.error).toBe("The reel is private");
    expect(result.output).toEqual({ errorCode: "reel_private" });
  });

  it("outputIsRoot: the whole payload body becomes output, not payload.output", () => {
    const result = normalizeExternalJobPollPayload(
      { success: true, status: "completed", schemaVersion: "2", observation: { hook: "x" } },
      { statusField: "status", outputIsRoot: true },
    );
    expect(result.output).toEqual({
      success: true,
      status: "completed",
      schemaVersion: "2",
      observation: { hook: "x" },
    });
  });

  it("outputIsRoot with a declared-failed response still folds errorCode into the root-derived output", () => {
    const result = normalizeExternalJobPollPayload(
      { success: false, error: { code: "apify_failure", message: "upstream scrape failed" } },
      { statusField: "status", outputIsRoot: true },
    );
    expect(result.status).toBe("failed");
    expect(result.error).toBe("upstream scrape failed");
    expect(result.output).toEqual({
      success: false,
      error: { code: "apify_failure", message: "upstream scrape failed" },
      errorCode: "apify_failure",
    });
  });

  it("without outputIsRoot, falls back to the conventional payload.output nesting", () => {
    const result = normalizeExternalJobPollPayload(
      { status: "completed", output: { articleId: "a1" } },
      { statusField: "status", outputIsRoot: false },
    );
    expect(result.output).toEqual({ articleId: "a1" });
  });
});

describe("mission_dispatcher_node.dispatchPendingRuns", () => {
  it("dispatches a pending run with context, run, and instructions carried atomically by the exec", async () => {
    const t = convexTest(schema, modules);
    const { missionId, runId } = await seedActiveProjectAgentAndPendingRun(t);

    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      expect(run?.status).toBe("running");
      expect(run?.dispatchCommandId).toBeDefined();
      const mission = await ctx.db.get(missionId);
      expect(mission?.status).toBe("doing");

      const commands = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("instanceId"), INSTANCE_ID))
        .collect();

      const writes = commands.filter((c) => c.type === RUNTIME_WORKSPACE_FILE_WRITE);
      const execs = commands.filter((c) => c.type === RUNTIME_OPENCLAW_EXEC);
      expect(writes).toHaveLength(0);
      expect(execs).toHaveLength(1);

      const exec = execs[0];
      expect((exec.payload as { workspaceKey: string }).workspaceKey).toBe(WORKSPACE_KEY);
      // Order matters: context must be ready before the agent reads the run.
      expect(execFilesToWrite(exec).map((file) => file.filePath)).toEqual([
        `missions/${missionId}/context.md`,
        `missions/${missionId}/runs/${runId}.md`,
        "AGENTS.md",
      ]);
      const contextWrite = findExecFile(commands, `missions/${missionId}/context.md`);
      expect(contextWrite!.content).not.toContain("# Brand Core");
      expect(run?.dispatchCommandId).toBe(exec._id);
      const commandText = (exec.payload as { commandText: string }).commandText;
      expect(commandText).toContain(`--agent ${OPENCLAW_AGENT}`);
      expect(commandText).toContain(`--session-id mega-mission-${missionId}`);
      expect(commandText).toContain(
        `Read missions/${missionId}/runs/${runId}.md. Follow the instructions there. On completion, write the RunResult to missions/${missionId}/outputs/${runId}.json.`,
      );
      expect(commandText).toContain("--json");
      expect(commandText).toContain("--timeout");
    });
  });

  it("persists agentsMdSnapshot/contextMdSnapshot on the Run, matching the content actually dispatched (ADR-050)", async () => {
    const t = convexTest(schema, modules);
    const { missionId, runId } = await seedActiveProjectAgentAndPendingRun(t);

    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const commands = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("instanceId"), INSTANCE_ID))
        .collect();
      const contextWrite = findExecFile(commands, `missions/${missionId}/context.md`);
      const agentsWrite = findExecFile(commands, "AGENTS.md");

      expect(run?.contextMdSnapshot).toBe(contextWrite!.content);
      expect(run?.agentsMdSnapshot).toBe(agentsWrite!.content);
    });
  });

  it("restores the base AGENTS.md for a Mission type without a per-mission file", async () => {
    const t = convexTest(schema, modules);
    await seedActiveProjectAgentAndPendingEngageRun(t);

    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});

    await t.run(async (ctx) => {
      const commands = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("instanceId"), SOCIAL_INSTANCE_ID))
        .collect();
      const exec = commands.find((command) => command.type === RUNTIME_OPENCLAW_EXEC);
      const agentsWrite = exec
        ? execFilesToWrite(exec).find((file) => file.filePath === "AGENTS.md")
        : undefined;

      expect(agentsWrite).toBeDefined();
      const content = agentsWrite!.content;
      expect(content).toContain("# Engagement Agent");
      expect(content).not.toContain("---\n# Create");
    });
  });

  it("uses the Template's computeRunMaxMs (not a fixed 1h) as the exec --timeout for a Template declaring sessionDurationMs", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await seedActiveProjectAgentAndPendingEngageRun(t);

    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});

    await t.run(async (ctx) => {
      const commands = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("instanceId"), SOCIAL_INSTANCE_ID))
        .collect();
      const exec = commands.find((c) => c.type === RUNTIME_OPENCLAW_EXEC);
      expect(exec).toBeDefined();
      // No payload override: falls back to the generic MISSION_RUN_MAX_MS-derived deadline (900_000ms = 900s).
      expect((exec!.payload as { timeoutMs: number }).timeoutMs).toBe(900_000);
      expect((exec!.payload as { commandText: string }).commandText).toContain("--timeout 900");

      const run = await ctx.db.get(runId);
      expect(run?.dispatchedAt).toBeDefined();
    });
  });

  it("derives the exec --timeout from the generic default session budget for an engage Mission with no payload override", async () => {
    const t = convexTest(schema, modules);
    await seedActiveProjectAgentAndPendingEngageRun(t);

    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});

    await t.run(async (ctx) => {
      const commands = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("instanceId"), SOCIAL_INSTANCE_ID))
        .collect();

      const exec = commands.find((c) => c.type === RUNTIME_OPENCLAW_EXEC);
      // No override: default budget (900_000 - 300_000 margin) = 600_000ms,
      // + 300_000 margin back for the exec timeout = 900_000ms.
      expect((exec!.payload as { timeoutMs: number }).timeoutMs).toBe(900_000);
    });
  });

  it("derives the exec --timeout from the Mission payload's sessionDurationMs override", async () => {
    const t = convexTest(schema, modules);
    await seedActiveProjectAgentAndPendingEngageRun(t, {
      payload: { platform: "instagram", followLiked: true, sessionDurationMs: 300_000 },
    });

    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});

    await t.run(async (ctx) => {
      const commands = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("instanceId"), SOCIAL_INSTANCE_ID))
        .collect();

      const exec = commands.find((c) => c.type === RUNTIME_OPENCLAW_EXEC);
      // 300_000 override + 300_000 margin = 600_000ms.
      expect((exec!.payload as { timeoutMs: number }).timeoutMs).toBe(600_000);
    });
  });

  it("resolves the Instagram account handle into context.md when the Mission payload's platform is instagram (issue #352)", async () => {
    const t = convexTest(schema, modules);
    const { missionId } = await seedActiveProjectAgentAndPendingEngageRun(t, {
      payload: { platform: "instagram", followLiked: true },
    });

    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});

    await t.run(async (ctx) => {
      const commands = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("instanceId"), SOCIAL_INSTANCE_ID))
        .collect();
      const contextWrite = findExecFile(commands, `missions/${missionId}/context.md`);
      const content = contextWrite!.content;
      expect(content).toContain("@ig-handle");
      expect(content).not.toContain("@tt-handle");
      expect(content).toContain("Instagram handle");
    });
  });

  it("renders the exact Social Engagement runtime context section into an engage Run's context.md (issue #660)", async () => {
    const t = convexTest(schema, modules);
    const { missionId, runId } = await seedActiveProjectAgentAndPendingEngageRun(t, {
      payload: { platform: "tiktok", followLiked: true },
    });

    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});

    await t.run(async (ctx) => {
      const commands = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("instanceId"), SOCIAL_INSTANCE_ID))
        .collect();
      const content = findExecFile(commands, `missions/${missionId}/context.md`)!.content;
      expect(content).toContain(
        [
          "## Social Engagement Runtime Context",
          "",
          `- runId: \`${runId}\``,
          "- platform: `tiktok`",
          "- accountHandle (TikTok handle): `@tt-handle`",
          "- accountBio: Street photography account",
          "- likeWhen: Street photography, urban architecture",
          "",
        ].join("\n"),
      );
      expect(content).not.toContain("- avoid:");
      expect(content).not.toContain("- commentWhen:");
    });
  });

  it("resolves the TikTok account handle into context.md when the Mission payload's platform is tiktok (issue #352)", async () => {
    const t = convexTest(schema, modules);
    const { missionId } = await seedActiveProjectAgentAndPendingEngageRun(t, {
      payload: { platform: "tiktok", followLiked: true },
    });

    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});

    await t.run(async (ctx) => {
      const commands = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("instanceId"), SOCIAL_INSTANCE_ID))
        .collect();
      const contextWrite = findExecFile(commands, `missions/${missionId}/context.md`);
      const content = contextWrite!.content;
      expect(content).toContain("@tt-handle");
      expect(content).not.toContain("@ig-handle");
      expect(content).toContain("TikTok handle");
    });
  });

  it("dispatches a non-engage run successfully despite its payload carrying no platform (issue #454)", async () => {
    // Any Mission type other than `engage` shares social-engagement's
    // Template with `engage`, whose payload always carries a `platform`. Only
    // `engage` declares the platform-account context provider, so without that
    // per-Mission-type declaration this would hit the exact same "no supported
    // platform" failure as the test above on every such dispatch. Uses an
    // arbitrary non-engage type rather than a real Mission type of this
    // Template — social-engagement no longer declares one beyond `engage`
    // itself (`score`/`routing` moved to the `source` Agent, issue #584).
    const t = convexTest(schema, modules);
    const now = Date.now();
    const { missionId, runId } = await t.run(async (ctx) => {
      await ctx.db.insert("projectAgents", {
        instanceId: SOCIAL_INSTANCE_ID,
        templateId: "@opengroow/engagement",
        workspaceKey: SOCIAL_WORKSPACE_KEY,
        openclawAgentName: SOCIAL_AGENT,
        status: "active",
        mcpServerKeys: [],
        config: {
          accountHandleInstagram: "@ig-handle",
          accountBio: "Street photography account",
          likeWhen: "Street photography, urban architecture",
        },
        createdAt: now,
        updatedAt: now,
      });
      const missionId = await ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId: SOCIAL_INSTANCE_ID,
        templateId: "@opengroow/engagement",
        type: "some-other-mission-type",
        payload: {},
        status: "todo",
        createdAt: now,
        updatedAt: now,
      });
      const runId = await ctx.db.insert("runs", {
        missionId,
        ownerId: OWNER_ID,
        instanceId: SOCIAL_INSTANCE_ID,
        templateId: "@opengroow/engagement",
        agentName: SOCIAL_AGENT,
        sessionKey: `mega-mission-${missionId}`,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
      return { missionId, runId };
    });

    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      expect(run?.status).not.toBe("failed");
      const commands = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("instanceId"), SOCIAL_INSTANCE_ID))
        .collect();
      const exec = commands.find((command) => command.type === RUNTIME_OPENCLAW_EXEC);
      expect(exec).toBeDefined();
    });
  });

  it("fails the run instead of defaulting to Instagram when an engage payload carries no platform (issue #352)", async () => {
    // Reachable in production: `missions.create` takes `payload: v.any()`, the
    // dashboard has a raw-JSON escape hatch, and Schedules created before #352
    // stored a payload with no `platform` at all.
    const t = convexTest(schema, modules);
    const { missionId, runId } = await seedActiveProjectAgentAndPendingEngageRun(t, {
      payload: { followLiked: true },
    });

    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      expect(run?.status).toBe("failed");
      expect(run?.errorMessage).toContain("platform");
      const commands = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("instanceId"), SOCIAL_INSTANCE_ID))
        .collect();
      expect(findExecFile(commands, `missions/${missionId}/context.md`)).toBeUndefined();
    });
  });

  it("fails an engage Run on an unknown platform with the platform-account provider's message (issue #660)", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await seedActiveProjectAgentAndPendingEngageRun(t, {
      payload: { platform: "threads", followLiked: true },
    });

    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      expect(run?.status).toBe("failed");
      expect(run?.errorMessage).toContain(
        'platform-account context: the Mission payload has no supported `platform` (got "threads"; expected one of instagram, tiktok)',
      );
    });
  });

  it("dispatches at most MISSION_DISPATCHER_MAX_PER_TICK=5 runs per call", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 7; i++) {
      await seedPendingRunForInstance(t, `inst-${i}`, `tpl-${i}`, 1000 + i);
    }

    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});

    await t.run(async (ctx) => {
      const allRuns = await ctx.db.query("runs").collect();
      const running = allRuns.filter((r) => r.status === "running");
      const stillPending = allRuns.filter((r) => r.status === "pending");
      expect(running).toHaveLength(5);
      expect(stillPending).toHaveLength(2);
    });
  });

  it("marks run failed (no return to pending) when dispatch inputs are missing", async () => {
    const t = convexTest(schema, modules);
    const { missionId, runId } = await t.run(async (ctx) => {
      const now = Date.now();
      const mid = await ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        status: "todo",
        createdAt: now,
        updatedAt: now,
      });
      const rid = await ctx.db.insert("runs", {
        missionId: mid,
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        agentName: OPENCLAW_AGENT,
        sessionKey: `mega-mission-${mid}`,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
      return { missionId: mid, runId: rid };
    });

    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      expect(run?.status).toBe("failed");
      expect(mission?.status).toBe("failed");
      expect(run?.errorMessage).toContain("dispatch_inputs_missing");
    });
  });

  it("stops early and does no work when no pending run exists", async () => {
    const t = convexTest(schema, modules);
    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});
    await t.run(async (ctx) => {
      const cmds = await ctx.db.query("commands").collect();
      expect(cmds).toHaveLength(0);
    });
  });

  it("SEO dispatch with complete config: context.md contains runId but not apiKey or the now-dead seoProjectId config field", async () => {
    const t = convexTest(schema, modules);
    const { missionId, runId } = await seedActiveProjectAgentAndPendingRun(t);

    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});

    await t.run(async (ctx) => {
      const commands = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("instanceId"), INSTANCE_ID))
        .collect();

      const contextWrite = findExecFile(commands, `missions/${missionId}/context.md`);
      expect(contextWrite).toBeDefined();

      const content = contextWrite!.content;
      expect(content).toContain(String(runId));
      // The project is now resolved from the apiKey on article-mcp's side (article-mcp#115) —
      // "proj-disp" is a stale config field carried over from a pre-migration Agent
      // (ADR-034) and must never be injected into the runtime context anymore.
      expect(content).not.toContain("proj-disp");
      expect(content).not.toContain("key-disp");
      expect(content).not.toContain("apiKey");
    });
  });

  it("dispatches context.md with the Project Brand Core before Mission and runtime context after Mission", async () => {
    const t = convexTest(schema, modules);
    const { missionId, runId } = await seedActiveProjectAgentAndPendingRun(t);

    await t.run(async (ctx) => {
      await ctx.db.insert("brandCores", {
        instanceId: INSTANCE_ID,
        audience: "Independent shop owners",
        tone: "Clear and direct",
        updatedAt: Date.now(),
      });
    });

    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});

    await t.run(async (ctx) => {
      const commands = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("instanceId"), INSTANCE_ID))
        .collect();

      const contextWrite = findExecFile(commands, `missions/${missionId}/context.md`);
      expect(contextWrite).toBeDefined();

      const content = contextWrite!.content;
      expect(content).toMatch(/^# Brand Core\n/);
      expect(content).toContain("Apply this brand guidance to everything you produce in this mission.");
      expect(content).toContain("## Audience\n\nIndependent shop owners");
      expect(content.indexOf("# Brand Core")).toBeLessThan(content.indexOf(`# Mission ${missionId}`));
      expect(content.indexOf(`# Mission ${missionId}`)).toBeLessThan(content.indexOf("## SEO Runtime Context"));
      expect(content).toContain(String(runId));
    });
  });

  it("loads a non-empty Brand Core for dispatch inputs and omits it when no Brand Core exists", async () => {
    const withBrandCore = convexTest(schema, modules);
    const { runId } = await seedActiveProjectAgentAndPendingRun(withBrandCore);

    await withBrandCore.run(async (ctx) => {
      await ctx.db.insert("brandCores", {
        instanceId: INSTANCE_ID,
        audience: "Independent shop owners",
        tone: "Clear and direct",
        updatedAt: Date.now(),
      });
    });

    await expect(
      withBrandCore.query(internal.mission_dispatcher.loadDispatchInputs, { runId }),
    ).resolves.toMatchObject({
      mission: {
        brandCore: {
          audience: "Independent shop owners",
          tone: "Clear and direct",
        },
      },
    });

    const withoutBrandCore = convexTest(schema, modules);
    const { runId: runIdWithoutBrandCore } =
      await seedActiveProjectAgentAndPendingRun(withoutBrandCore);

    const inputs = await withoutBrandCore.query(internal.mission_dispatcher.loadDispatchInputs, {
      runId: runIdWithoutBrandCore,
    });

    expect(inputs).not.toBeNull();
    expect(inputs!.mission).not.toHaveProperty("brandCore");
  });

  it("uses the latest Brand Core on the next dispatch while an already dispatched Run keeps its context", async () => {
    const t = convexTest(schema, modules);
    const { missionId: firstMissionId } = await seedActiveProjectAgentAndPendingRun(t);

    await t.run(async (ctx) => {
      await ctx.db.insert("brandCores", {
        instanceId: INSTANCE_ID,
        audience: "Original audience",
        updatedAt: Date.now(),
      });
    });

    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});

    const firstContext = await t.run(async (ctx) => {
      const commands = await ctx.db.query("commands").collect();
      return findExecFile(commands, `missions/${firstMissionId}/context.md`)!.content;
    });

    await t.run(async (ctx) => {
      const brandCore = await ctx.db
        .query("brandCores")
        .withIndex("by_instance", (q) => q.eq("instanceId", INSTANCE_ID))
        .unique();
      await ctx.db.patch(brandCore!._id, {
        audience: "Updated audience",
        updatedAt: Date.now(),
      });
      const firstRun = await ctx.db
        .query("runs")
        .withIndex("by_mission", (q) => q.eq("missionId", firstMissionId))
        .unique();
      await ctx.db.patch(firstRun!._id, {
        status: "completed",
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.patch(firstMissionId, {
        status: "done",
        updatedAt: Date.now(),
      });
    });

    const { missionId: secondMissionId } = await seedPendingMissionRun(t);

    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});

    await t.run(async (ctx) => {
      const commands = await ctx.db.query("commands").collect();
      const secondContext = findExecFile(
        commands,
        `missions/${secondMissionId}/context.md`,
      )!.content;

      expect(firstContext).toContain("Original audience");
      expect(firstContext).not.toContain("Updated audience");
      expect(secondContext).toContain("Updated audience");
      expect(secondContext).not.toContain("Original audience");
    });
  });

  it("SEO dispatch with missing config: run marked failed with dispatch_inputs_missing, no workspace writes", async () => {
    const t = convexTest(schema, modules);
    const { missionId, runId } = await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        workspaceKey: WORKSPACE_KEY,
        openclawAgentName: OPENCLAW_AGENT,
        status: "active",
        mcpServerKeys: [],
        createdAt: now,
        updatedAt: now,
      });
      const missionId = await ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: { topic: "Octopus" },
        status: "todo",
        createdAt: now,
        updatedAt: now,
      });
      const runId = await ctx.db.insert("runs", {
        missionId,
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        agentName: OPENCLAW_AGENT,
        sessionKey: `mega-mission-${missionId}`,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
      return { missionId, runId };
    });

    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      expect(run?.status).toBe("failed");
      expect(run?.errorMessage).toContain("dispatch_inputs_missing");
      expect(mission?.status).toBe("failed");

      const commands = await ctx.db.query("commands").collect();
      expect(commands).toHaveLength(0);
    });
  });
});

async function seedRunningRunWithExecResult(
  t: ReturnType<typeof convexTest>,
  execOk: boolean,
): Promise<{ missionId: Id<"missions">; runId: Id<"runs">; execCommandId: Id<"commands"> }> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const missionId = await ctx.db.insert("missions", {
      ownerId: OWNER_ID,
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: {},
      status: "doing",
      createdAt: now,
      updatedAt: now,
    });
    const execCommandId = await ctx.db.insert("commands", {
      instanceId: INSTANCE_ID,
      type: RUNTIME_OPENCLAW_EXEC,
      payload: { commandText: "openclaw agent ..." },
      status: "queued",
      attempts: 0,
      createdAt: now,
    });
    const runId = await ctx.db.insert("runs", {
      missionId,
      ownerId: OWNER_ID,
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      agentName: OPENCLAW_AGENT,
      sessionKey: `mega-mission-${missionId}`,
      status: "running",
      dispatchCommandId: execCommandId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("projectAgents", {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      workspaceKey: WORKSPACE_KEY,
      openclawAgentName: OPENCLAW_AGENT,
      status: "active",
      mcpServerKeys: [],
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("events", {
      instanceId: INSTANCE_ID,
      eventId: buildRuntimeResultEventId(execCommandId),
      type: RUNTIME_OPENCLAW_EXEC_RESULT,
      payload: { ok: execOk, error: execOk ? undefined : "boom" },
      ts: now,
      createdAt: now,
    });
    return { missionId, runId, execCommandId };
  });
}

describe("mission_dispatcher_node.reconcileRuns", () => {
  it("on exec ok=true, dispatches a workspace FILE_READ on the canonical outputs path and records its commandId on the run", async () => {
    const t = convexTest(schema, modules);
    const { missionId, runId } = await seedRunningRunWithExecResult(t, true);

    await t.action(internal.mission_dispatcher_node.reconcileRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      expect(run?.status).toBe("running");
      expect(run?.resultReadCommandId).toBeDefined();
      const reads = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("type"), RUNTIME_WORKSPACE_FILE_READ))
        .collect();
      expect(reads).toHaveLength(1);
      expect((reads[0].payload as { workspaceKey: string }).workspaceKey).toBe(WORKSPACE_KEY);
      expect((reads[0].payload as { filePath: string }).filePath).toBe(
        `missions/${missionId}/outputs/${runId}.json`,
      );
      expect(run?.resultReadCommandId).toBe(reads[0]._id);
    });

    const log = await t.query(internal.mission_dispatcher.listReconcileDecisions, { runId });
    expect(log).toHaveLength(1);
    expect(log[0].decision).toMatchObject({
      type: "enqueueRead",
      role: "result",
      filePath: `missions/${missionId}/outputs/${runId}.json`,
    });
  });

  it("logs (and collapses) consecutive wait decisions across ticks, then logs the next real decision", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await t.run(async (ctx) => {
      const now = Date.now();
      const missionId = await ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        status: "doing",
        createdAt: now,
        updatedAt: now,
      });
      const cmdId = await ctx.db.insert("commands", {
        instanceId: INSTANCE_ID,
        type: RUNTIME_OPENCLAW_EXEC,
        payload: {},
        status: "queued",
        attempts: 0,
        createdAt: now,
      });
      const rid = await ctx.db.insert("runs", {
        missionId,
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        agentName: OPENCLAW_AGENT,
        sessionKey: `mega-mission-${missionId}`,
        status: "running",
        dispatchCommandId: cmdId,
        createdAt: now,
        updatedAt: now,
      });
      return { runId: rid };
    });

    // No exec result event yet on either tick: decideReconciliation returns `wait` both times.
    await t.action(internal.mission_dispatcher_node.reconcileRuns, {});
    await t.action(internal.mission_dispatcher_node.reconcileRuns, {});

    let log = await t.query(internal.mission_dispatcher.listReconcileDecisions, { runId });
    expect(log).toHaveLength(1);
    expect(log[0].decision).toEqual({ type: "wait" });

    // Now the exec result lands: the next tick produces a real (non-wait) decision.
    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      await ctx.db.insert("events", {
        instanceId: INSTANCE_ID,
        eventId: buildRuntimeResultEventId(run!.dispatchCommandId!),
        type: RUNTIME_OPENCLAW_EXEC_RESULT,
        payload: { ok: true },
        ts: Date.now(),
        createdAt: Date.now(),
      });
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        workspaceKey: WORKSPACE_KEY,
        openclawAgentName: OPENCLAW_AGENT,
        status: "active",
        mcpServerKeys: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    await t.action(internal.mission_dispatcher_node.reconcileRuns, {});

    log = await t.query(internal.mission_dispatcher.listReconcileDecisions, { runId });
    expect(log.map((d) => d.decision.type)).toEqual(["wait", "enqueueRead"]);
  });

  it("silently skips a running run with no exec result event yet", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await t.run(async (ctx) => {
      const now = Date.now();
      const missionId = await ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        status: "doing",
        createdAt: now,
        updatedAt: now,
      });
      const cmdId = await ctx.db.insert("commands", {
        instanceId: INSTANCE_ID,
        type: RUNTIME_OPENCLAW_EXEC,
        payload: {},
        status: "queued",
        attempts: 0,
        createdAt: now,
      });
      const rid = await ctx.db.insert("runs", {
        missionId,
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        agentName: OPENCLAW_AGENT,
        sessionKey: `mega-mission-${missionId}`,
        status: "running",
        dispatchCommandId: cmdId,
        createdAt: now,
        updatedAt: now,
      });
      return { runId: rid };
    });

    await t.action(internal.mission_dispatcher_node.reconcileRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      expect(run?.status).toBe("running");
      expect(run?.resultReadCommandId).toBeUndefined();
    });
  });

  it("on exec ok=false, marks the run failed with code runtime and the mission failed", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await seedRunningRunWithExecResult(t, false);

    await t.action(internal.mission_dispatcher_node.reconcileRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      expect(run?.status).toBe("failed");
      expect(mission?.status).toBe("failed");
      expect(run?.errorMessage).toContain("runtime:");
    });
  });

  async function setupRunWithReadResult(
    t: ReturnType<typeof convexTest>,
    readPayload: unknown,
    opts?: { retryableFailureCount?: number },
  ): Promise<{ runId: Id<"runs">; missionId: Id<"missions"> }> {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const missionId = await ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        status: "doing",
        createdAt: now,
        updatedAt: now,
        ...(opts?.retryableFailureCount !== undefined
          ? { retryableFailureCount: opts.retryableFailureCount }
          : {}),
      });
      const execId = await ctx.db.insert("commands", {
        instanceId: INSTANCE_ID,
        type: RUNTIME_OPENCLAW_EXEC,
        payload: {},
        status: "queued",
        attempts: 0,
        createdAt: now,
      });
      const readId = await ctx.db.insert("commands", {
        instanceId: INSTANCE_ID,
        type: RUNTIME_WORKSPACE_FILE_READ,
        payload: {},
        status: "queued",
        attempts: 0,
        createdAt: now,
      });
      const rid = await ctx.db.insert("runs", {
        missionId,
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        agentName: OPENCLAW_AGENT,
        sessionKey: `mega-mission-${missionId}`,
        status: "running",
        dispatchCommandId: execId,
        resultReadCommandId: readId,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        workspaceKey: WORKSPACE_KEY,
        openclawAgentName: OPENCLAW_AGENT,
        status: "active",
        mcpServerKeys: [],
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("events", {
        instanceId: INSTANCE_ID,
        eventId: buildRuntimeResultEventId(execId),
        type: RUNTIME_OPENCLAW_EXEC_RESULT,
        payload: { ok: true },
        ts: now,
        createdAt: now,
      });
      await ctx.db.insert("events", {
        instanceId: INSTANCE_ID,
        eventId: buildRuntimeResultEventId(readId),
        type: RUNTIME_WORKSPACE_FILE_READ_RESULT,
        payload: readPayload,
        ts: now,
        createdAt: now,
      });
      return { runId: rid, missionId };
    });
  }

  it("transitions run+mission to completed/done when read result contains a valid success RunResult", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await setupRunWithReadResult(t, {
      ok: true,
      data: { content: JSON.stringify({ status: "success", summary: "ok" }) },
    });

    await t.action(internal.mission_dispatcher_node.reconcileRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      expect(run?.status).toBe("completed");
      expect(mission?.status).toBe("done");
      expect(mission?.lastResult?.status).toBe("success");
    });
  });

  it("marks run failed with file_missing when read result is ok=false", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await setupRunWithReadResult(t, {
      ok: false,
      // The raw fs error the gateway actually returns when the agent never
      // wrote its RunResult — it leaks an internal absolute container path.
      error:
        "ENOENT: no such file or directory, lstat '/home/node/.openclaw/workspace-abc/missions/m1/outputs'",
    });

    await t.action(internal.mission_dispatcher_node.reconcileRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      expect(run?.status).toBe("failed");
      expect(mission?.status).toBe("failed");
      expect(run?.errorMessage).toContain("file_missing");
      // Stored message is human-readable, not a raw ENOENT/container-path dump.
      expect(run?.errorMessage).toContain(
        "finished without writing its result file",
      );
      expect(run?.errorMessage).not.toContain("ENOENT");
      expect(run?.errorMessage).not.toContain("/home/node/");
    });
  });

  it("marks run failed with file_invalid when read result content is not valid JSON and the invalid-output retry budget is exhausted", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await setupRunWithReadResult(
      t,
      { ok: true, data: { content: "{not json" } },
      { retryableFailureCount: 3 },
    );

    await t.action(internal.mission_dispatcher_node.reconcileRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      expect(run?.status).toBe("failed");
      expect(run?.errorMessage).toContain("file_invalid");
    });
  });

  it("resumes the Mission (not a terminal failure) with the parse error surfaced to the agent when the invalid-output retry budget isn't exhausted", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await setupRunWithReadResult(t, {
      ok: true,
      data: { content: "{not json" },
    });

    await t.action(internal.mission_dispatcher_node.reconcileRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      expect(run?.status).toBe("resumed");
      expect(mission?.status).toBe("doing");
      expect(mission?.retryableFailureCount).toBe(1);
      expect(mission?.lastRetryableFailure?.error).toBeDefined();
      const newRuns = await ctx.db
        .query("runs")
        .withIndex("by_mission", (q) => q.eq("missionId", missionId))
        .collect();
      expect(newRuns).toHaveLength(2);
      expect(newRuns.some((r) => r.status === "pending")).toBe(true);
    });
  });

  it("transitions run to awaiting_job (mission stays doing) when read result is an in_progress job pointer", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await setupRunWithReadResult(t, {
      ok: true,
      data: {
        content: JSON.stringify({
          status: "in_progress",
          summary: "Video production started; awaiting render.",
          reviewQuestions: ["Is the video ready to publish?"],
          job: { mcpServer: "video-mcp", jobId: "render-abc-123", jobType: "produce_video" },
        }),
      },
    });

    await t.action(internal.mission_dispatcher_node.reconcileRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      // The job is not yet done — the run waits for OpenGroow to poll it.
      expect(run?.status).toBe("awaiting_job");
      expect(run?.mcpJob?.jobId).toBe("render-abc-123");
      expect(run?.mcpJob?.serverName).toBe("video-mcp");
      expect(run?.mcpJob?.reviewQuestions).toEqual([
        "Is the video ready to publish?",
      ]);
      // The run did not fail and the mission is still in progress.
      expect(run?.errorMessage).toBeUndefined();
      expect(mission?.status).toBe("doing");
    });
  });

  // --- OpenGroow polls an outstanding MCP job to a terminal state (#138) ---

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function setupAwaitingJobVideoRun(
    t: ReturnType<typeof convexTest>,
    opts: { jobId?: string } = {},
  ): Promise<{ runId: Id<"runs">; missionId: Id<"missions">; jobId: string }> {
    const jobId = opts.jobId ?? "render-abc-123";
    return await t.run(async (ctx) => {
      const now = Date.now();
      const instanceId = "inst-video";
      const templateId = "@opengroow/video-demo";
      const missionId = await ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId,
        templateId,
        type: "lym_create_letter_video",
        payload: {},
        status: "doing",
        createdAt: now,
        updatedAt: now,
      });
      const runId = await ctx.db.insert("runs", {
        missionId,
        ownerId: OWNER_ID,
        instanceId,
        templateId,
        agentName: "video-demo",
        sessionKey: `mega-mission-${missionId}`,
        status: "awaiting_job",
        mcpJob: {
          serverName: "video-mcp",
          jobId,
          summary: "Video produced and awaiting human review.",
          reviewQuestions: ["Is the video ready to publish?"],
          jobType: "produce_video",
          missionType: "lym_create_letter_video",
        },
        dispatchedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("projectAgents", {
        instanceId,
        templateId,
        workspaceKey: "ws-video",
        openclawAgentName: "video-demo",
        status: "active",
        mcpServerKeys: [],
        config: { apiKey: "video-key" },
        createdAt: now,
        updatedAt: now,
      });
      return { runId, missionId, jobId };
    });
  }

  /**
   * Stub the MCP tool call used to poll External Job status.
   * The dispatcher calls `callMcpTool(mcpUrl, contract.mcpTool, { runId: jobId }, ...)`
   * which POSTs JSON-RPC to the MCP URL. The mock returns a well-formed MCP
   * tools/call response wrapping `payload` as a JSON text content item.
   *
   * Returns the mock `fetch` so callers can assert on it (URL, tool name, jobId).
   */
  function mockExternalJobStatus(payload: Record<string, unknown>) {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "application/json" },
      json: async () => ({
        result: {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          isError: false,
        },
      }),
    });
    vi.stubGlobal("fetch", mockFetch);
    return mockFetch;
  }

  // --- pollExternalJobs: External Job polling via Template-declared MCP tool (issue #145) ---
  // These tests verify the SEPARATE polling loop (pollExternalJobs) which is
  // distinct from the Agent dispatch loop (reconcileRuns + dispatchPendingRuns).
  // The contract uses `mcpTool: "get_run_status"` (the real service's only
  // status channel) instead of a fabricated REST path.

  it("completes an awaiting_job run (needs_human_review) when external job status is completed", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId, jobId } = await setupAwaitingJobVideoRun(t);
    // Mock the MCP tool call: contract declares mcpTool "get_run_status"
    const mockFetch = mockExternalJobStatus({ status: "completed" });

    await t.action(internal.mission_dispatcher_node.pollExternalJobs, {});

    // Assert the poll called the correct MCP tool on the correct endpoint.
    // This guards against regressions where the wrong path or mechanism is used.
    expect(mockFetch).toHaveBeenCalledOnce();
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    // The video template's activationUrl is the MCP endpoint (POST /mcp)
    expect(calledUrl).toBe("http://localhost:4100/mcp");
    const body = JSON.parse(calledInit.body as string) as {
      method: string;
      params: { name: string; arguments: Record<string, unknown> };
    };
    // Contract declares mcpTool: "get_run_status" — not a fabricated REST path
    expect(body.method).toBe("tools/call");
    expect(body.params.name).toBe("get_run_status");
    // jobId must be forwarded as { runId: jobId } — as the tool's input schema requires
    expect(body.params.arguments).toEqual({ runId: jobId });

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      expect(run?.status).toBe("completed");
      expect(mission?.status).toBe("to_validate");
      const result = run?.result;
      expect(result?.status).toBe("needs_human_review");
      // The artifact pointer must carry external.id (generic shape, ADR-020).
      // Identity lives only in external.id — no legacy metadata.runId mirror.
      const artifact =
        result && "artifact" in result ? result.artifact : undefined;
      expect(artifact?.external?.id).toBe(jobId);
      expect(artifact?.external?.service).toBe("video-mcp");
      expect(artifact?.metadata?.runId).toBeUndefined();
    });

    const log = await t.query(internal.mission_dispatcher.listReconcileDecisions, { runId });
    expect(log).toHaveLength(1);
    expect(log[0].decision.type).toBe("markCompleted");
  });

  it("completes an awaiting_job run when external job status is success (live video-mcp value)", async () => {
    // The deployed video-mcp reports a finished job as `success`, not the
    // `completed` its docs claim; the reconciler must treat both as terminal.
    // Both are declared in the video Template's externalJob.terminalStates.completed list.
    const t = convexTest(schema, modules);
    const { runId, missionId, jobId } = await setupAwaitingJobVideoRun(t);
    mockExternalJobStatus({
      status: "success",
      output: { finalVideoPath: "/runs/x/outputs/final.mp4" },
    });

    await t.action(internal.mission_dispatcher_node.pollExternalJobs, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      expect(run?.status).toBe("completed");
      expect(mission?.status).toBe("to_validate");
      const result = run?.result;
      expect(result?.status).toBe("needs_human_review");
      const artifact =
        result && "artifact" in result ? result.artifact : undefined;
      expect(artifact?.external?.id).toBe(jobId);
      expect(artifact?.metadata?.runId).toBeUndefined();
    });
  });

  it("resumes the Mission (not a terminal failure) on a 4xx status and the contract declares onFail: resume_mission", async () => {
    // The video template's produce_video contract declares onFail: "resume_mission"
    // (retry the Manifest instead of failing outright, e.g. an over-length Letter
    // title) — this failure is the very first one for this Mission (well under
    // MAX_RETRYABLE_JOB_FAILURES), and the error is a 4xx (agent-fixable), so it
    // resumes rather than fails.
    const t = convexTest(schema, modules);
    const { runId, missionId } = await setupAwaitingJobVideoRun(t);
    mockExternalJobStatus({
      status: "failed",
      error: "Letter service failed: 400 Bad Request — title too long",
    });

    await t.action(internal.mission_dispatcher_node.pollExternalJobs, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      expect(run?.status).toBe("resumed");
      expect(mission?.status).toBe("doing");
      expect(mission?.retryableFailureCount).toBe(1);
      expect(mission?.lastRetryableFailure).toEqual({
        jobType: "produce_video",
        error: "Letter service failed: 400 Bad Request — title too long",
      });
    });
  });

  it("fails terminally (not retried) on a 5xx status even though the contract declares onFail: resume_mission", async () => {
    // A 5xx means the external service itself is broken — retrying with a
    // corrected Manifest changes nothing, so this never resumes regardless of
    // the retry budget.
    const t = convexTest(schema, modules);
    const { runId, missionId } = await setupAwaitingJobVideoRun(t);
    mockExternalJobStatus({
      status: "failed",
      error: "Letter service failed: 500 Internal Server Error",
    });

    await t.action(internal.mission_dispatcher_node.pollExternalJobs, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      expect(run?.status).toBe("failed");
      expect(mission?.status).toBe("failed");
      expect(mission?.retryableFailureCount ?? 0).toBe(0);
      expect(run?.errorMessage).toContain("external_job_failed");
      expect(run?.errorMessage).toContain("500 Internal Server Error");
    });
  });

  it("fails terminally once retryableFailureCount reaches MAX_RETRYABLE_JOB_FAILURES, even on a 4xx", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await setupAwaitingJobVideoRun(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(missionId, { retryableFailureCount: MAX_RETRYABLE_JOB_FAILURES });
    });
    mockExternalJobStatus({
      status: "failed",
      error: "Letter service failed: 400 Bad Request — still broken",
    });

    await t.action(internal.mission_dispatcher_node.pollExternalJobs, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      expect(run?.status).toBe("failed");
      expect(mission?.status).toBe("failed");
      expect(run?.errorMessage).toContain("external_job_failed");
      expect(run?.errorMessage).toContain("400 Bad Request");
    });
  });

  it("leaves an awaiting_job run untouched while the job is still rendering", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await setupAwaitingJobVideoRun(t);
    mockExternalJobStatus({ status: "rendering", nextPollAfterSeconds: 30 });

    await t.action(internal.mission_dispatcher_node.pollExternalJobs, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      // Not terminal yet: the run waits for a later tick, not marked failed.
      expect(run?.status).toBe("awaiting_job");
      expect(run?.result).toBeUndefined();
      expect(run?.errorMessage).toBeUndefined();
      expect(mission?.status).toBe("doing");
    });

    const log = await t.query(internal.mission_dispatcher.listReconcileDecisions, { runId });
    expect(log).toHaveLength(1);
    expect(log[0].decision).toEqual({ type: "wait" });
  });

  it("records a clear Run/Mission failure when polling returns malformed status (missing statusField)", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await setupAwaitingJobVideoRun(t);
    // Response has no `status` field — the contract's statusField is missing/non-string
    mockExternalJobStatus({ state: "running" });

    await t.action(internal.mission_dispatcher_node.pollExternalJobs, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      expect(run?.status).toBe("failed");
      expect(mission?.status).toBe("failed");
      expect(run?.errorMessage).toContain("external_job_poll_failed");
      expect(run?.errorMessage).toContain("malformed");
    });
  });

  it("tolerates a transient service outage: an awaiting_job run is not lost", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await setupAwaitingJobVideoRun(t);
    // The external service is unreachable on this tick — fetch rejects.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    await t.action(internal.mission_dispatcher_node.pollExternalJobs, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      // The run survives to be retried; a transient outage must not fail it.
      expect(run?.status).toBe("awaiting_job");
      expect(run?.errorMessage).toBeUndefined();
      expect(mission?.status).toBe("doing");
    });
  });

  it("fails an awaiting_job run when the Template has no externalJob polling contract declared", async () => {
    // A run whose templateId has no externalJob contract in the manifest cannot
    // be polled — this is a permanent misconfiguration, so the run fails immediately
    // rather than retrying forever.
    const t = convexTest(schema, modules);
    // Seed a run with a templateId that has no externalJob contract (hello has none)
    const { runId, missionId } = await t.run(async (ctx) => {
      const now = Date.now();
      const mid = await ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId: "inst-hello-no-contract",
        templateId: "@opengroow/hello",
        type: "demo",
        payload: {},
        status: "doing",
        createdAt: now,
        updatedAt: now,
      });
      const rid = await ctx.db.insert("runs", {
        missionId: mid,
        ownerId: OWNER_ID,
        instanceId: "inst-hello-no-contract",
        templateId: "@opengroow/hello",
        agentName: "hello",
        sessionKey: `mega-mission-${mid}`,
        status: "awaiting_job",
        mcpJob: {
          serverName: "hello-mcp",
          jobId: "job-xyz",
          summary: "Running…",
          reviewQuestions: [],
          jobType: "do_thing",
        },
        dispatchedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      return { runId: rid, missionId: mid };
    });

    await t.action(internal.mission_dispatcher_node.pollExternalJobs, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      expect(run?.status).toBe("failed");
      expect(mission?.status).toBe("failed");
      expect(run?.errorMessage).toContain("external_job_poll_failed");
      expect(run?.errorMessage).toContain("External Job polling contract");
    });
  });

  async function setupAwaitingJobSeoArticleRun(
    t: ReturnType<typeof convexTest>,
    opts: { jobId?: string } = {},
  ): Promise<{ runId: Id<"runs">; missionId: Id<"missions">; jobId: string }> {
    const jobId = opts.jobId ?? "exec-abc-123";
    return await t.run(async (ctx) => {
      const now = Date.now();
      const instanceId = "inst-seo-article";
      const templateId = "@opengroow/seo";
      const missionId = await ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId,
        templateId,
        type: "create_article",
        payload: {},
        status: "doing",
        createdAt: now,
        updatedAt: now,
      });
      const runId = await ctx.db.insert("runs", {
        missionId,
        ownerId: OWNER_ID,
        instanceId,
        templateId,
        agentName: "seo",
        sessionKey: `mega-mission-${missionId}`,
        status: "awaiting_job",
        mcpJob: {
          serverName: "article-mcp",
          jobId,
          summary: "Article generation in progress — keyword: octopus",
          reviewQuestions: ["Is the article ready to publish?"],
          jobType: "generate_article",
          missionType: "create_article",
        },
        dispatchedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("projectAgents", {
        instanceId,
        templateId,
        workspaceKey: "ws-seo-article",
        openclawAgentName: "seo",
        status: "active",
        mcpServerKeys: [],
        config: { apiKey: "seo-key" },
        createdAt: now,
        updatedAt: now,
      });
      return { runId, missionId, jobId };
    });
  }

  it("uses output[resultIdField] as artifact.external.id when contract declares resultIdField (create_article)", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await setupAwaitingJobSeoArticleRun(t);
    mockExternalJobStatus({ status: "completed", output: { articleId: "art-123", title: "Octopus article" } });

    await t.action(internal.mission_dispatcher_node.pollExternalJobs, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      expect(run?.status).toBe("completed");
      expect(mission?.status).toBe("to_validate");
      const result = run?.result;
      expect(result?.status).toBe("needs_human_review");
      const artifact = result && "artifact" in result ? result.artifact : undefined;
      // resultIdField "articleId" → artifact.external.id = "art-123", NOT the polling jobId
      expect(artifact?.external?.id).toBe("art-123");
      expect(artifact?.external?.service).toBe("article-mcp");
    });
  });

  it("resolves the polling contract through the Run's Project: a Project without the Template fails the poll", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await setupAwaitingJobSeoArticleRun(t);
    setTemplateRegistryForTests(inMemoryRegistry(["some-other-project"], [await officialFixtureTemplate("@opengroow/seo")]));
    mockExternalJobStatus({ status: "completed", output: { articleId: "art-123" } });

    await t.action(internal.mission_dispatcher_node.pollExternalJobs, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      expect(run?.status).toBe("failed");
      expect(run?.errorMessage).toContain("Template not found: @opengroow/seo");
    });
  });

  it("times out an awaiting_job run past its own computeRunMaxMs, computed per-run rather than once for the whole tick", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await setupAwaitingJobSeoArticleRun(t);
    // seo/create_article declares no sessionDurationMs, so computeRunMaxMs falls
    // back to MISSION_RUN_MAX_MS (900_000ms) — push dispatchedAt past that.
    await t.run(async (ctx) => {
      await ctx.db.patch(runId, { dispatchedAt: Date.now() - 950_000 });
    });
    // The timeout path is only reached when the poll itself is transient
    // (service unreachable) — a network failure, not a 4xx/5xx response.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    await t.action(internal.mission_dispatcher_node.pollExternalJobs, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      expect(run?.status).toBe("failed");
      expect(mission?.status).toBe("failed");
      expect(run?.errorMessage).toContain("Run exceeded 900000 ms");
    });
  });

  it("video regression: artifact.external.id = jobId when contract has no resultIdField", async () => {
    const t = convexTest(schema, modules);
    const jobId = "render-regression-456";
    const { runId, missionId } = await setupAwaitingJobVideoRun(t, { jobId });
    mockExternalJobStatus({ status: "completed" });

    await t.action(internal.mission_dispatcher_node.pollExternalJobs, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      expect(run?.status).toBe("completed");
      expect(mission?.status).toBe("to_validate");
      const artifact = run?.result && "artifact" in run.result ? run.result.artifact : undefined;
      // No resultIdField → artifact.external.id = original jobId (not from output)
      expect(artifact?.external?.id).toBe(jobId);
    });
  });

  it("Agent dispatch loop (reconcileRuns) does NOT process awaiting_job runs — they belong to pollExternalJobs", async () => {
    // This is the no-Agent-side-polling-dependency guarantee (acceptance criterion #7).
    // reconcileRuns must skip awaiting_job runs entirely; pollExternalJobs handles them.
    const t = convexTest(schema, modules);
    const { runId, missionId } = await setupAwaitingJobVideoRun(t);
    // Do NOT stub fetch — if reconcileRuns tried to poll the job it would throw.

    await t.action(internal.mission_dispatcher_node.reconcileRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      // awaiting_job run must remain untouched after reconcileRuns
      expect(run?.status).toBe("awaiting_job");
      expect(run?.errorMessage).toBeUndefined();
      expect(mission?.status).toBe("doing");
    });
  });

  it("tick() runs both reconcile and dispatch in the same call", async () => {
    const t = convexTest(schema, modules);
    // a pending run waiting to dispatch
    const pending = await seedActiveProjectAgentAndPendingRun(t);
    // a running run with exec ok=true ready to be reconciled — must be a different (instance,template) to avoid claim blocking
    const running = await t.run(async (ctx) => {
      const now = Date.now();
      const instanceId = "inst-running";
      const templateId = "tpl-running";
      await ctx.db.insert("projectAgents", {
        instanceId,
        templateId,
        workspaceKey: "ws-running",
        openclawAgentName: templateId,
        status: "active",
        mcpServerKeys: [],
        createdAt: now,
        updatedAt: now,
      });
      const missionId = await ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId,
        templateId,
        type: "x",
        payload: {},
        status: "doing",
        createdAt: now,
        updatedAt: now,
      });
      const cmdId = await ctx.db.insert("commands", {
        instanceId,
        type: RUNTIME_OPENCLAW_EXEC,
        payload: {},
        status: "queued",
        attempts: 0,
        createdAt: now,
      });
      const rid = await ctx.db.insert("runs", {
        missionId,
        ownerId: OWNER_ID,
        instanceId,
        templateId,
        agentName: templateId,
        sessionKey: `mega-mission-${missionId}`,
        status: "running",
        dispatchCommandId: cmdId,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("events", {
        instanceId,
        eventId: buildRuntimeResultEventId(cmdId),
        type: RUNTIME_OPENCLAW_EXEC_RESULT,
        payload: { ok: true },
        ts: now,
        createdAt: now,
      });
      return { runId: rid };
    });

    await t.action(internal.mission_dispatcher_node.tick, {});

    await t.run(async (ctx) => {
      const dispatched = await ctx.db.get(pending.runId);
      expect(dispatched?.status).toBe("running");
      const reconciled = await ctx.db.get(running.runId);
      expect(reconciled?.resultReadCommandId).toBeDefined();
    });
  });

  it("does not time out a run past MISSION_RUN_MAX_MS once an EXEC_RESULT ok=true is present (proceeds to file read)", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await t.run(async (ctx) => {
      const old = Date.now() - 2_000_000;
      const mid = await ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        status: "doing",
        createdAt: old,
        updatedAt: old,
      });
      const cmdId = await ctx.db.insert("commands", {
        instanceId: INSTANCE_ID,
        type: RUNTIME_OPENCLAW_EXEC,
        payload: {},
        status: "queued",
        attempts: 0,
        createdAt: old,
      });
      const rid = await ctx.db.insert("runs", {
        missionId: mid,
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        agentName: OPENCLAW_AGENT,
        sessionKey: `mega-mission-${mid}`,
        status: "running",
        dispatchedAt: old,
        dispatchCommandId: cmdId,
        createdAt: old,
        updatedAt: old,
      });
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        workspaceKey: WORKSPACE_KEY,
        openclawAgentName: OPENCLAW_AGENT,
        status: "active",
        mcpServerKeys: [],
        createdAt: old,
        updatedAt: old,
      });
      await ctx.db.insert("events", {
        instanceId: INSTANCE_ID,
        eventId: buildRuntimeResultEventId(cmdId),
        type: RUNTIME_OPENCLAW_EXEC_RESULT,
        payload: { ok: true },
        ts: Date.now(),
        createdAt: Date.now(),
      });
      return { runId: rid, missionId: mid };
    });

    await t.action(internal.mission_dispatcher_node.reconcileRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      expect(run?.status).toBe("running");
      expect(run?.errorMessage).toBeUndefined();
      expect(run?.resultReadCommandId).toBeDefined();
      expect(mission?.status).toBe("doing");
      const reads = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("type"), RUNTIME_WORKSPACE_FILE_READ))
        .collect();
      expect(reads).toHaveLength(1);
    });
  });

  it("does not time out a fresh running run whose dispatchedAt is within MISSION_RUN_MAX_MS", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await t.run(async (ctx) => {
      const now = Date.now();
      const mid = await ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        status: "doing",
        createdAt: now,
        updatedAt: now,
      });
      const cmdId = await ctx.db.insert("commands", {
        instanceId: INSTANCE_ID,
        type: RUNTIME_OPENCLAW_EXEC,
        payload: {},
        status: "queued",
        attempts: 0,
        createdAt: now,
      });
      const rid = await ctx.db.insert("runs", {
        missionId: mid,
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        agentName: OPENCLAW_AGENT,
        sessionKey: `mega-mission-${mid}`,
        status: "running",
        dispatchedAt: now - 1_000,
        dispatchCommandId: cmdId,
        createdAt: now,
        updatedAt: now,
      });
      return { runId: rid };
    });

    await t.action(internal.mission_dispatcher_node.reconcileRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      expect(run?.status).toBe("running");
      expect(run?.errorMessage).toBeUndefined();
    });
  });

  it("attempts a salvage read instead of failing immediately when no exec result event exists past MISSION_RUN_MAX_MS", async () => {
    // The openclaw exec's own completion signal can go missing even after the Agent actually
    // finished (its OS process can hang instead of exiting cleanly). Rather than discarding
    // possibly-completed work, the first timed-out tick tries reading the workspace outputs
    // file before giving up — same as it already would if execResult.ok had arrived normally.
    const t = convexTest(schema, modules);
    const { runId, missionId } = await t.run(async (ctx) => {
      const old = Date.now() - 2_000_000;
      const mid = await ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        status: "doing",
        createdAt: old,
        updatedAt: old,
      });
      const cmdId = await ctx.db.insert("commands", {
        instanceId: INSTANCE_ID,
        type: RUNTIME_OPENCLAW_EXEC,
        payload: {},
        status: "queued",
        attempts: 0,
        createdAt: old,
      });
      const rid = await ctx.db.insert("runs", {
        missionId: mid,
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        agentName: OPENCLAW_AGENT,
        sessionKey: `mega-mission-${mid}`,
        status: "running",
        dispatchedAt: old,
        dispatchCommandId: cmdId,
        createdAt: old,
        updatedAt: old,
      });
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        workspaceKey: WORKSPACE_KEY,
        openclawAgentName: OPENCLAW_AGENT,
        status: "active",
        mcpServerKeys: [],
        createdAt: old,
        updatedAt: old,
      });
      return { runId: rid, missionId: mid };
    });

    await t.action(internal.mission_dispatcher_node.reconcileRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      expect(run?.status).toBe("running");
      expect(run?.resultReadCommandId).toBeDefined();
      expect(mission?.status).toBe("doing");
    });
  });

  it("fails with timeout once the salvage read's own grace period also elapses with no result", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await t.run(async (ctx) => {
      // Old enough that both the run's own MISSION_RUN_MAX_MS budget AND the salvage read's
      // extra grace period have already elapsed by the time this tick runs.
      const old = Date.now() - 3_000_000;
      const mid = await ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        status: "doing",
        createdAt: old,
        updatedAt: old,
      });
      const cmdId = await ctx.db.insert("commands", {
        instanceId: INSTANCE_ID,
        type: RUNTIME_OPENCLAW_EXEC,
        payload: {},
        status: "queued",
        attempts: 0,
        createdAt: old,
      });
      const readCmdId = await ctx.db.insert("commands", {
        instanceId: INSTANCE_ID,
        type: RUNTIME_WORKSPACE_FILE_READ,
        payload: {},
        status: "queued",
        attempts: 0,
        createdAt: old,
      });
      const rid = await ctx.db.insert("runs", {
        missionId: mid,
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        agentName: OPENCLAW_AGENT,
        sessionKey: `mega-mission-${mid}`,
        status: "running",
        dispatchedAt: old,
        dispatchCommandId: cmdId,
        // A salvage read was already dispatched on a previous tick and never resolved.
        resultReadCommandId: readCmdId,
        createdAt: old,
        updatedAt: old,
      });
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        workspaceKey: WORKSPACE_KEY,
        openclawAgentName: OPENCLAW_AGENT,
        status: "active",
        mcpServerKeys: [],
        createdAt: old,
        updatedAt: old,
      });
      return { runId: rid, missionId: mid };
    });

    await t.action(internal.mission_dispatcher_node.reconcileRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      expect(run?.status).toBe("failed");
      expect(run?.errorMessage).toContain("timeout:");
      expect(mission?.status).toBe("failed");
    });
  });

  it("times out a run stuck in dispatching with no dispatchCommandId once dispatchedAt exceeds MISSION_RUN_MAX_MS", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await t.run(async (ctx) => {
      const now = Date.now();
      const mid = await ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        status: "doing",
        createdAt: now,
        updatedAt: now,
      });
      const rid = await ctx.db.insert("runs", {
        missionId: mid,
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        agentName: OPENCLAW_AGENT,
        sessionKey: `mega-mission-${mid}`,
        status: "dispatching",
        dispatchedAt: now - 2_000_000,
        createdAt: now - 2_000_000,
        updatedAt: now - 2_000_000,
      });
      return { runId: rid, missionId: mid };
    });

    await t.action(internal.mission_dispatcher_node.reconcileRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      expect(run?.status).toBe("failed");
      expect(run?.errorMessage).toContain("timeout:");
      expect(run?.errorMessage).toMatch(/Run exceeded \d+ ms/);
      expect(mission?.status).toBe("failed");
    });
  });

  it("times out an engage run using the Mission payload's sessionDurationMs override, not the Template's default", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await t.run(async (ctx) => {
      // A short 10_000ms override means the deadline (10_000 + 300_000 margin
      // = 310_000ms) has already passed 400_000ms ago — but the Template's
      // own default (120_000 + 300_000 = 420_000ms) would NOT have elapsed
      // yet, so this only fails if reconcileRuns actually reads the override.
      const now = Date.now();
      const mid = await ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId: SOCIAL_INSTANCE_ID,
        templateId: "@opengroow/engagement",
        type: "engage",
        payload: { followLiked: true, sessionDurationMs: 10_000 },
        status: "doing",
        createdAt: now,
        updatedAt: now,
      });
      const rid = await ctx.db.insert("runs", {
        missionId: mid,
        ownerId: OWNER_ID,
        instanceId: SOCIAL_INSTANCE_ID,
        templateId: "@opengroow/engagement",
        agentName: SOCIAL_AGENT,
        sessionKey: `mega-mission-${mid}`,
        status: "dispatching",
        dispatchedAt: now - 400_000,
        createdAt: now - 400_000,
        updatedAt: now - 400_000,
      });
      return { runId: rid, missionId: mid };
    });

    await t.action(internal.mission_dispatcher_node.reconcileRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      expect(run?.status).toBe("failed");
      expect(run?.errorMessage).toContain("Run exceeded 310000 ms");
      expect(mission?.status).toBe("failed");
    });
  });

  it("marks run failed with file_invalid when content does not match RunResult schema and the invalid-output retry budget is exhausted", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await setupRunWithReadResult(
      t,
      { ok: true, data: { content: JSON.stringify({ status: "success" }) } }, // missing summary
      { retryableFailureCount: 3 },
    );

    await t.action(internal.mission_dispatcher_node.reconcileRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      expect(run?.status).toBe("failed");
      expect(run?.errorMessage).toContain("file_invalid");
      // Stored message is human-readable, not a raw Zod JSON dump.
      expect(run?.errorMessage).toContain("missing summary");
      expect(run?.errorMessage).not.toContain("invalid_type");
    });
  });

  it("resumes the Mission with the schema error surfaced to the agent when content does not match RunResult schema and the invalid-output retry budget isn't exhausted", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await setupRunWithReadResult(t, {
      ok: true,
      data: { content: JSON.stringify({ status: "success" }) }, // missing summary
    });

    await t.action(internal.mission_dispatcher_node.reconcileRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      expect(run?.status).toBe("resumed");
      expect(mission?.status).toBe("doing");
      expect(mission?.retryableFailureCount).toBe(1);
      expect(mission?.lastRetryableFailure?.error).toContain("missing summary");
    });
  });
});

describe("loadDispatchInputs", () => {
  it("returns stored config when projectAgent has a config field", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        workspaceKey: WORKSPACE_KEY,
        openclawAgentName: OPENCLAW_AGENT,
        status: "active",
        mcpServerKeys: [],
        config: { seoProjectId: "proj-42", apiKey: "key-abc" },
        createdAt: now,
        updatedAt: now,
      });
      const missionId = await ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        status: "todo",
        createdAt: now,
        updatedAt: now,
      });
      const runId = await ctx.db.insert("runs", {
        missionId,
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        agentName: OPENCLAW_AGENT,
        sessionKey: `mega-mission-${missionId}`,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
      return { runId };
    });

    const result = await t.query(internal.mission_dispatcher.loadDispatchInputs, { runId });

    expect(result).not.toBeNull();
    expect(result!.config).toEqual({ seoProjectId: "proj-42", apiKey: "key-abc" });
  });

  it("returns config: null when projectAgent has no config field", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: "@opengroow/hello",
        workspaceKey: WORKSPACE_KEY,
        openclawAgentName: "hello",
        status: "active",
        mcpServerKeys: [],
        createdAt: now,
        updatedAt: now,
      });
      const missionId = await ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: "@opengroow/hello",
        type: "demo",
        payload: {},
        status: "todo",
        createdAt: now,
        updatedAt: now,
      });
      const runId = await ctx.db.insert("runs", {
        missionId,
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: "@opengroow/hello",
        agentName: "hello",
        sessionKey: `mega-mission-${missionId}`,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
      return { runId };
    });

    const result = await t.query(internal.mission_dispatcher.loadDispatchInputs, { runId });

    expect(result).not.toBeNull();
    expect(result!.config).toBeNull();
  });
});
