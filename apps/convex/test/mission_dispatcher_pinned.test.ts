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


import { afterEach, beforeEach } from "vitest";
import { createInMemoryTemplateRegistry } from "@opengroow/agent-templates/registry";

type FileToWrite = { filePath: string; content: string };

const INSTANCE = "openclaw-instance-pinned";
const TEMPLATE_ID = "@opengroow/seo";
const OWNER = "owner-pinned";

/** The SEO fixture with its own base instructions and Mission-type providers. */
function templateVersion(label: string, providers: string[] | undefined): AgentTemplate {
  const base = officialFixtureTemplate(TEMPLATE_ID);
  return {
    ...base,
    agentsMd: `# Base instructions ${label}\n`,
    missionAgentsMd: { create_article: `# Mission instructions ${label}\n` },
    manifest: {
      ...base.manifest,
      runContext: undefined,
      requirements: [],
      contextProviders: undefined,
      missionTypes: base.manifest.missionTypes?.map((mt) =>
        mt.type === "create_article" ? { ...mt, contextProviders: providers } : mt,
      ),
    },
  };
}

function useVersions(versions: Array<{ version: string; template: AgentTemplate }>) {
  setTemplateRegistryForTests(
    createInMemoryTemplateRegistry(versions.map((v) => ({ projectId: INSTANCE, ...v }))),
  );
}

beforeEach(() => {
  // v1 is pinned and declares a provider; v2 is current and declares none.
  useVersions([
    { version: "1.0.0", template: templateVersion("v1", ["active-agents"]) },
    { version: "2.0.0", template: templateVersion("v2", undefined) },
  ]);
});
afterEach(() => setTemplateRegistryForTests(undefined));

async function seedMission(t: ReturnType<typeof convexTest>, templateVersion?: string) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("projectAgents", {
      instanceId: INSTANCE,
      templateId: TEMPLATE_ID,
      workspaceKey: "ws-pinned",
      openclawAgentName: "seo",
      status: "active",
      mcpServerKeys: [],
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.insert("missions", {
      ownerId: OWNER,
      instanceId: INSTANCE,
      templateId: TEMPLATE_ID,
      ...(templateVersion !== undefined ? { templateVersion } : {}),
      type: "create_article",
      payload: { topic: "Octopus" },
      status: "todo",
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function addPendingRun(t: ReturnType<typeof convexTest>, missionId: Id<"missions">) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("runs", {
      missionId,
      ownerId: OWNER,
      instanceId: INSTANCE,
      templateId: TEMPLATE_ID,
      agentName: "seo",
      sessionKey: `mega-mission-${missionId}`,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function sentFiles(t: ReturnType<typeof convexTest>, runId: Id<"runs">) {
  return await t.run(async (ctx) => {
    const run = await ctx.db.get(runId);
    const command = await ctx.db.get(run!.dispatchCommandId!);
    const files = (command!.payload as { filesToWrite: FileToWrite[] }).filesToWrite;
    return {
      agents: files.find((f) => f.filePath === "AGENTS.md")!.content,
      context: files.find((f) => f.filePath.endsWith("context.md"))!.content,
    };
  });
}

describe("Runs dispatch at the Mission's pinned Template version", () => {
  it("sends the pinned version's instructions and providers to the first Run while a newer version is current", async () => {
    const t = convexTest(schema, modules);
    const missionId = await seedMission(t, "1.0.0");
    const runId = await addPendingRun(t, missionId);

    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});

    const { agents, context } = await sentFiles(t, runId);
    expect(agents).toContain("Base instructions v1");
    expect(agents).toContain("Mission instructions v1");
    expect(context).toContain("Active Agents");
  });

  it("keeps the pinned version for a retry and a revision Run", async () => {
    const t = convexTest(schema, modules);
    const missionId = await seedMission(t, "1.0.0");
    const first = await addPendingRun(t, missionId);
    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});
    await t.run(async (ctx) => {
      await ctx.db.patch(first, { status: "failed" });
    });
    const retry = await addPendingRun(t, missionId);
    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});
    await t.run(async (ctx) => {
      await ctx.db.patch(retry, { status: "completed" });
    });
    const revision = await addPendingRun(t, missionId);
    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});

    for (const runId of [retry, revision]) {
      const { agents, context } = await sentFiles(t, runId);
      expect(agents).toContain("Base instructions v1");
      expect(context).toContain("Active Agents");
    }
  });

  it("follows the current version for a Mission without a pinned version", async () => {
    const t = convexTest(schema, modules);
    const missionId = await seedMission(t);
    const runId = await addPendingRun(t, missionId);

    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});

    const { agents, context } = await sentFiles(t, runId);
    expect(agents).toContain("Base instructions v2");
    expect(context).not.toContain("Active Agents");
  });

  it("fails the Run with template_version_missing when the pinned version is not installed", async () => {
    const t = convexTest(schema, modules);
    const missionId = await seedMission(t, "0.9.0");
    const runId = await addPendingRun(t, missionId);

    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      expect(run?.status).toBe("failed");
      expect(run?.errorMessage).toContain("template_version_missing");
      expect(run?.errorMessage).toContain("0.9.0");
      expect(run?.dispatchCommandId).toBeUndefined();
    });
  });
});
