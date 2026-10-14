import { insertInstance } from "./instance_fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { join } from "node:path";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import {
  RUNTIME_COMMAND_UNSUPPORTED,
  RUNTIME_PLUGINS_INSTALL,
  RUNTIME_AGENT_CREDENTIAL_SET,
} from "@opengroow/protocol";
import type { Doc } from "../_generated/dataModel";
import { readPackageFolder } from "../../../packages/agent-templates/src/package-folder";
import { withFile } from "../../../packages/agent-templates/src/__fixtures__/claw-package";

/**
 * The generic engagement package installed from its folder (#663): no built-in
 * Template is involved, so the exclusive resource and the delivered credential
 * come from the installed package's declarations.
 */
vi.mock("../runtime_commands_node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../runtime_commands_node")>();
  const { internal: generatedInternal } = await import("../_generated/api");
  return {
    ...actual,
    enqueueInteractiveCommand: (
      ctx: Parameters<typeof actual.enqueueInteractiveCommand>[0],
      args: Parameters<typeof actual.enqueueInteractiveCommand>[1],
    ) => ctx.runMutation(generatedInternal.commands.enqueueInteractive, args),
    waitForRuntimeEvent: vi.fn(async (ctx: any, instanceId: string, commandId: string) => {
      const command = await ctx.runQuery(generatedInternal.commands.getCommand, { commandId });
      const payload = (command?.payload ?? {}) as Record<string, unknown>;
      if (!command || /compound|batch/.test(command.type)) {
        return { status: 200, found: true, type: RUNTIME_COMMAND_UNSUPPORTED, payload: { ok: false, commandId, instanceId } };
      }
      return {
        status: 200,
        found: true,
        type: `${command.type}.result`,
        payload: {
          ok: true,
          commandId,
          instanceId,
          data: {
            ...payload,
            absolutePath: "/home/node/.openclaw/workspace-se",
            mergedKeys: ["feed-mcp"],
            agentId: "opengroow--engagement",
            registered: true,
            configured: false,
          },
        },
      };
    }),
  };
});

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
  "../missions_node.ts": () => import("../missions_node.js"),
  "../runs.ts": () => import("../runs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../project_agents_node.ts": () => import("../project_agents_node.js"),
  "../project_templates.ts": () => import("../project_templates.js"),
  "../template_install_local.ts": () => import("../template_install_local.js"),
  "../runtime_commands_node.ts": () => import("../runtime_commands_node.js"),
  "../mission_dispatcher.ts": () => import("../mission_dispatcher.js"),
  "../mission_dispatcher_node.ts": () => import("../mission_dispatcher_node.js"),
};

const TEMPLATE_ID = "@opengroow/engagement";
const PROJECT_A = "openclaw-project-se-a";
const PROJECT_B = "openclaw-project-se-b";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|se", subject: "owner-se" };
const PACKAGE_DIR = join(import.meta.dirname, "..", "..", "..", "fixtures", "packages", "engagement");

/** The external package as the hosted deployment accepts it: a public MCP host instead of the development one. */
function engagementPackage() {
  const files = readPackageFolder(PACKAGE_DIR);
  const profile = files
    .find((f) => f.path === "profiles/opengroow.yml")!
    .content.replace(/^(\s+)url: http:\/\/host\.docker\.internal:\d+\/mcp$/m, "$1url: https://feed.example.com/mcp")
    .replace(/^\s+activationUrl: .*\n/m, "")
    .replace(/^\s+publicBaseUrl: .*\n/m, "");
  return withFile(files, "profiles/opengroow.yml", profile);
}

const USER_CONFIG = {
  apiKey: "enrich-key",
  classifierApiKey: "  agent-secret  ",
  accountBio: "Street photography account",
  likeWhen: "Street photography",
};

async function seedInstance(t: ReturnType<typeof convexTest>, projectId: string) {
  const now = new Date().toISOString();
  await t.run(async (ctx) => {
    await insertInstance(ctx, {
      jobId: `job-${projectId}`,
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: now,
      openclawId: projectId,
      updatedAt: now,
      userId: OWNER.subject,
    });
  });
}

const commandsOf = (t: ReturnType<typeof convexTest>) => t.run(async (ctx) => ctx.db.query("commands").collect());

describe("Engagement installed from an external package — engage Mission lifecycle (#663)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK", headers: new Headers(), json: async () => ({}) }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function installAndActivate(t: ReturnType<typeof convexTest>, projectId: string) {
    await seedInstance(t, projectId);
    const as = t.withIdentity(OWNER);
    // The package declares the reserved `source_ingestion` Job type, so it is installable only from the official hub (#666).
    await t.mutation(internal.template_install_local.installHub, {
      projectId,
      files: engagementPackage(),
      gitOrigin: { repository: "https://github.com/opengroow/engagement", tag: "v0.0.1", archiveDigest: `sha256:${"0".repeat(64)}` },
    });
    const activation = await as.action(api.project_agents_node.activateProjectAgent, {
      instanceId: projectId,
      templateId: TEMPLATE_ID,
      userConfig: USER_CONFIG,
    });
    expect(activation.status).toBe("active");
    return as;
  }

  it("installs the package, delivers the marked credential and installs the packaged plugin on activation", async () => {
    const t = convexTest(schema, modules);
    await installAndActivate(t, PROJECT_A);

    const commands = await commandsOf(t);
    expect(commands.find((c) => c.type === RUNTIME_AGENT_CREDENTIAL_SET)?.payload).toEqual({
      agentId: "opengroow--engagement",
      apiKey: "agent-secret",
    });
    // profiles/openclaw.yml of the package: tool deny-list and exec node.
    const toolsConfig = commands
      .map((c) => JSON.stringify(c.payload))
      .find((text) => text.includes("agents.entries.opengroow--engagement.tools"));
    expect(toolsConfig).toContain("sessions_spawn");
    expect(toolsConfig).toContain("My Computer");
    const install = commands.find((c) => c.type === RUNTIME_PLUGINS_INSTALL);
    expect(JSON.stringify(install?.payload)).toContain("engagement-report-sync");
  });

  it("runs one engage at a time on the shared device", async () => {
    const t = convexTest(schema, modules);
    const asA = await installAndActivate(t, PROJECT_A);
    const asB = await installAndActivate(t, PROJECT_B);

    const payload = { variant: "a" };
    const a = await asA.mutation(api.missions.create, { instanceId: PROJECT_A, templateId: TEMPLATE_ID, type: "engage", payload, name: "A" });
    const b = await asB.mutation(api.missions.create, { instanceId: PROJECT_B, templateId: TEMPLATE_ID, type: "engage", payload, name: "B" });

    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});

    const runs = await t.run(async (ctx) => ctx.db.query("runs").collect());
    const pending = runs.filter((r) => r.status === "pending");
    expect(runs).toHaveLength(2);
    // exclusive resource `shared-device`, declared by the package: only one engage Run starts.
    expect(pending).toHaveLength(1);

    const dispatched = runs.find((r) => r.status !== "pending")!;
    expect([a.missionId, b.missionId]).toContain(dispatched.missionId);
    // The first Run's mission is the one in progress; the other waits for the device.
    const waiting = (await t.run(async (ctx) => ctx.db.get(pending[0]!.missionId!))) as Doc<"missions">;
    expect(waiting.status).toBe("todo");
  });
});
