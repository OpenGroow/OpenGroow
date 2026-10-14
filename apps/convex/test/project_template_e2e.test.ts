import { insertInstance } from "./instance_fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { RUNTIME_COMMAND_UNSUPPORTED, buildRuntimeResultEventId } from "@opengroow/protocol";
import { createMissionAwareDispatcher } from "../../fake-openclaw/src/openclaw-agent.js";
import type { Doc } from "../_generated/dataModel";
import { readHostedClawPackageFixture, withFile } from "../../../packages/agent-templates/src/__fixtures__/claw-package";

// Activation waits for runtime results: answer each command like a healthy
// Instance (generic `ok` result), except compound commands, reported as
// unsupported so activation takes its individual-command path.
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
            absolutePath: "/home/node/.openclaw/workspace-e2e",
            mergedKeys: ["article-mcp"],
            agentId: "seo",
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
  "../template_mcp_overrides.ts": () => import("../template_mcp_overrides.js"),
  "../runtime_commands_node.ts": () => import("../runtime_commands_node.js"),
  "../mission_dispatcher.ts": () => import("../mission_dispatcher.js"),
  "../mission_dispatcher_node.ts": () => import("../mission_dispatcher_node.js"),
};

const PROJECT = "openclaw-project-pt-e2e";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|pt", subject: "owner-pt" };
const MARKER = "# Installed from a Claw package (registry marker)\n";

async function drainCommands(t: ReturnType<typeof convexTest>, dispatch: ReturnType<typeof createMissionAwareDispatcher>) {
  await t.run(async (ctx) => {
    for (const c of await ctx.db.query("commands").collect()) {
      const eventId = buildRuntimeResultEventId(c._id);
      const exists = await ctx.db
        .query("events")
        .filter((q) => q.and(q.eq(q.field("instanceId"), c.instanceId), q.eq(q.field("eventId"), eventId)))
        .first();
      if (exists) continue;
      const evt = dispatch({ id: c._id, type: c.type, payload: c.payload, ts: c.createdAt }, c.instanceId);
      if (!evt) continue;
      await ctx.db.insert("events", {
        instanceId: c.instanceId,
        eventId: evt.id,
        type: evt.type,
        payload: evt.payload ?? null,
        ts: evt.ts,
        createdAt: Date.now(),
      });
    }
  });
}

describe("Project Template registry — Mission lifecycle from an installed package", () => {
  beforeEach(() => {
    // Activation's status-check: the MCP reports the Project as configured.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          result: {
            content: [{ type: "text", text: JSON.stringify({ configured: true, dashboardUrl: "https://seo.example/p" }) }],
          },
        }),
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("installs the SEO package, activates the Agent and takes create_article to to_validate, approve then publish", async () => {
    const t = convexTest(schema, modules);
    const now = new Date().toISOString();
    await t.run(async (ctx) => {
      await insertInstance(ctx, {
        jobId: `job-${PROJECT}`,
        status: "running",
        runtimeStatus: "linked",
        runtimeReady: true,
        createdAt: now,
        openclawId: PROJECT,
        updatedAt: now,
        userId: OWNER.subject,
      });
    });
    const as = t.withIdentity(OWNER);

    const files = withFile(readHostedClawPackageFixture("seo"), "workspace/AGENTS.md", MARKER);
    await as.mutation(api.project_templates.install, { projectId: PROJECT, files });

    const activation = await as.action(api.project_agents_node.activateProjectAgent, {
      instanceId: PROJECT,
      templateId: "@acme/seo",
      userConfig: { apiKey: "key-pt" },
    });
    expect(activation.status).toBe("active");
    // The workspace was materialized from the installed package, not a built-in Template.
    const writes = await t.run(async (ctx) =>
      (await ctx.db.query("commands").collect()).filter((c) => c.type === "runtime.workspace.file.write"),
    );
    expect(writes.some((c) => (c.payload as { content?: string }).content === MARKER)).toBe(true);

    const { missionId } = await as.mutation(api.missions.create, {
      instanceId: PROJECT,
      templateId: "@acme/seo",
      type: "create_article",
      payload: { keyword: "octopus" },
      name: "Installed SEO mission",
    });

    const dispatch = createMissionAwareDispatcher();
    await t.action(internal.mission_dispatcher_node.tick, {});
    await drainCommands(t, dispatch);
    await t.action(internal.mission_dispatcher_node.tick, {});
    await drainCommands(t, dispatch);
    await t.action(internal.mission_dispatcher_node.tick, {});

    const mission = (await t.run(async (ctx) => ctx.db.get(missionId))) as Doc<"missions">;
    expect(mission.status).toBe("to_validate");

    // The fake Agent reports no artifact: give the Mission one so the review
    // actions declared by the installed manifest can run.
    await t.run(async (ctx) => {
      await ctx.db.patch(missionId, {
        lastResult: {
          status: "needs_human_review",
          summary: "ready",
          reviewQuestions: [],
          artifact: { kind: "markdown", external: { service: "article-mcp", id: "art-pt-1" }, metadata: {} },
        } as Doc<"missions">["lastResult"],
      });
    });
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        calls.push(String(url));
        return { ok: true, status: 200, statusText: "OK", json: async () => ({}) };
      }),
    );

    await as.action(api.missions_node.performReviewAction, { missionId, actionKey: "approve" });
    expect(((await t.run(async (ctx) => ctx.db.get(missionId))) as Doc<"missions">).status).toBe("approved");
    await as.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" });
    expect(((await t.run(async (ctx) => ctx.db.get(missionId))) as Doc<"missions">).status).toBe("done");
    expect(calls.some((u) => u.includes("/articles/art-pt-1/approve"))).toBe(true);
  });
});

// The public install is self-host only (#707): these tests install packages the way a self-hosted owner does.
beforeEach(() => {
  vi.stubEnv("IS_SELF_HOST", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
});
