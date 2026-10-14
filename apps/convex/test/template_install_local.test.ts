import { insertInstance } from "./instance_fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FunctionArgs } from "convex/server";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { RUNTIME_COMMAND_UNSUPPORTED, RUNTIME_HEALTH_RESULT, buildRuntimeResultEventId } from "@opengroow/protocol";
import { createMissionAwareDispatcher } from "../../fake-openclaw/src/openclaw-agent.js";
import type { Doc } from "../_generated/dataModel";
import { readHostedClawPackageFixture, withFile } from "../../../packages/agent-templates/src/__fixtures__/claw-package";

// Answer each runtime command like a healthy Instance; compound commands are
// reported unsupported so provisioning takes its individual-command path.
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
      const type = /health/.test(command.type) ? RUNTIME_HEALTH_RESULT : `${command.type}.result`;
      return {
        status: 200,
        found: true,
        type,
        payload: {
          ok: true,
          commandId,
          instanceId,
          data: {
            ...payload,
            absolutePath: "/home/node/.openclaw/workspace-local-folder",
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
  "../template_install_local.ts": () => import("../template_install_local.js"),
  "../template_mcp_overrides.ts": () => import("../template_mcp_overrides.js"),
  "../runtime_commands_node.ts": () => import("../runtime_commands_node.js"),
  "../mission_dispatcher.ts": () => import("../mission_dispatcher.js"),
  "../mission_dispatcher_node.ts": () => import("../mission_dispatcher_node.js"),
};

const addFromFolder = internal.template_install_local.addFromFolder;
const addFromGit = internal.template_install_local.addFromGit;
const linkFromFolder = internal.template_install_local.linkFromFolder;

const PROJECT = "openclaw-project-local-folder";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|lf", subject: "owner-lf" };
const SKILL = "acme/seo-helper";

/** The SEO package at a version, with a marker in its AGENTS.md and a required ClawHub skill. */
function seoPackage(version: string, marker: string) {
  const base = readHostedClawPackageFixture("seo");
  const claw = base.find((f) => f.path === "CLAW.md")!.content.replace(
    /\n---\n\n/,
    `\npackages:\n  - { kind: skill, source: clawhub, ref: ${SKILL}, version: 1.0.0 }\n---\n\n`,
  );
  let files = withFile(base, "CLAW.md", claw);
  files = withFile(files, "package.json", JSON.stringify({ name: "@acme/seo", version, openclaw: { claw: "CLAW.md" } }));
  return withFile(files, "workspace/AGENTS.md", marker);
}

async function seedInstance(t: ReturnType<typeof convexTest>, runtimeStatus: "linked" | "starting" | "provisioning" = "linked") {
  const now = new Date().toISOString();
  await t.run(async (ctx) => {
    await insertInstance(ctx, {
      jobId: `job-${PROJECT}`,
      status: "running",
      runtimeStatus,
      runtimeReady: true,
      createdAt: now,
      openclawId: PROJECT,
      updatedAt: now,
      userId: OWNER.subject,
    });
  });
}

/** The folder entry points are self-host only (#707), but the rest of these tests exercise the hosted provisioner: self-host just for the call. */
async function onSelfHost(t: ReturnType<typeof convexTest>, ref: typeof addFromFolder | typeof linkFromFolder, args: FunctionArgs<typeof addFromFolder>) {
  vi.stubEnv("IS_SELF_HOST", "1");
  try {
    return await t.action(ref, args);
  } finally {
    vi.stubEnv("IS_SELF_HOST", "");
  }
}

const commandsOf = (t: ReturnType<typeof convexTest>) => t.run(async (ctx) => ctx.db.query("commands").collect());
const workspaceWrites = (commands: Doc<"commands">[]) =>
  commands.filter((c) => c.type === "runtime.workspace.file.write").map((c) => c.payload as { filePath: string; content: string });
const skillInstalls = (commands: Doc<"commands">[]) =>
  commands.filter((c) => /clawhub install/.test((c.payload as { commandText?: string }).commandText ?? ""));

async function activate(as: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>) {
  const activation = await as.action(api.project_agents_node.activateProjectAgent, {
    instanceId: PROJECT,
    templateId: "@acme/seo",
    userConfig: { apiKey: "key-lf" },
  });
  expect(activation.status).toBe("active");
}

describe("Template installed from a local folder, Instance reconciled from the registry", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          result: { content: [{ type: "text", text: JSON.stringify({ configured: true, dashboardUrl: "https://seo.example/p" }) }] },
        }),
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("refuses the folder entry points on a hosted deployment (#707), while Git and hub installs stay open", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const files = seoPackage("0.0.1", "# v1\n");

    await expect(t.action(addFromFolder, { projectId: PROJECT, files })).rejects.toThrow(/only available on self-hosted/);
    await expect(t.action(linkFromFolder, { projectId: PROJECT, files })).rejects.toThrow(/only available on self-hosted/);
    expect(await t.run(async (ctx) => ctx.db.query("installedTemplates").collect())).toHaveLength(0);

    const gitOrigin = { repository: "https://github.com/acme/seo", tag: "v0.0.1", archiveDigest: `sha256:${"a".repeat(64)}` };
    await t.action(addFromGit, { projectId: PROJECT, files, gitOrigin });
    expect(await t.run(async (ctx) => ctx.db.query("installedTemplates").collect())).toHaveLength(1);
  });

  it("installs without a user identity and reports a Project with no active Agent as nothing to reconcile", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    const result = await onSelfHost(t, addFromFolder, { projectId: PROJECT, files: seoPackage("0.0.1", "# v1\n") });

    expect(result).toMatchObject({ templateId: "@acme/seo", version: "0.0.1", reconciled: [] });
    const stored = await t.run(async (ctx) => ctx.db.query("installedTemplates").collect());
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ projectId: PROJECT, origin: "local_folder" });
  });

  it("installs a Git release and records its Git origin on the Template", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const gitOrigin = { repository: "https://github.com/acme/seo", tag: "v0.0.1", archiveDigest: `sha256:${"a".repeat(64)}` };

    await t.action(addFromGit, { projectId: PROJECT, files: seoPackage("0.0.1", "# v1\n"), gitOrigin });

    const stored = await t.run(async (ctx) => ctx.db.query("installedTemplates").collect());
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ origin: "git", gitOrigin, current: true });
    const as = t.withIdentity(OWNER);
    expect(await as.query(api.project_templates.origins, { projectId: PROJECT })).toEqual([
      { templateId: "@acme/seo", version: "0.0.1", origin: "git", gitOrigin },
    ]);
  });

  it("refuses an invalid package naming the problem, and an unknown Project", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const profile = seoPackage("0.0.1", "").find((f) => f.path === "profiles/opengroow.yml")!.content;
    const broken = withFile(seoPackage("0.0.1", "# v1\n"), "profiles/opengroow.yml", `${profile}categoryy: marketing\n`);

    await expect(onSelfHost(t, addFromFolder, { projectId: PROJECT, files: broken })).rejects.toThrow(/categoryy/);
    await expect(
      onSelfHost(t, addFromFolder, { projectId: "openclaw-nope", files: seoPackage("0.0.1", "# v1\n") }),
    ).rejects.toThrow(/Project not found/);
    expect(await t.run(async (ctx) => ctx.db.query("installedTemplates").collect())).toHaveLength(0);
  });

  it("pushes the workspace files and skills of a new version to the active Agent's Instance", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const as = t.withIdentity(OWNER);
    await onSelfHost(t, addFromFolder, { projectId: PROJECT, files: seoPackage("0.0.1", "# v1\n") });
    await activate(as);
    const before = (await commandsOf(t)).length;

    const result = await onSelfHost(t, addFromFolder, { projectId: PROJECT, files: seoPackage("0.0.2", "# v2 marker\n") });

    expect(result.reconciled).toEqual([{ templateId: "@acme/seo", status: "refreshed" }]);
    const added = (await commandsOf(t)).slice(before);
    expect(workspaceWrites(added).some((w) => w.content === "# v2 marker\n")).toBe(true);
    expect(skillInstalls(added).map((c) => (c.payload as { commandText: string }).commandText)).toEqual([
      expect.stringContaining(SKILL),
    ]);
    const agent = await t.run(async (ctx) => ctx.db.query("projectAgents").first());
    expect(agent?.skills).toEqual([expect.objectContaining({ spec: SKILL, origin: "template", status: "installed" })]);
  });

  it("restores files and skills of the installed Templates after the Instance is reprovisioned", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const as = t.withIdentity(OWNER);
    await onSelfHost(t, addFromFolder, { projectId: PROJECT, files: seoPackage("0.0.1", "# v1 marker\n") });
    await activate(as);
    const before = (await commandsOf(t)).length;

    // A reprovisioned Instance comes back empty: replay the registry onto it.
    const results = await t.action(internal.project_agents_node.reconcileInstanceAgents, { instanceId: PROJECT });

    expect(results).toEqual([{ templateId: "@acme/seo", status: "refreshed" }]);
    const added = (await commandsOf(t)).slice(before);
    expect(workspaceWrites(added).some((w) => w.content === "# v1 marker\n")).toBe(true);
    expect(workspaceWrites(added).some((w) => w.filePath === "create_article.md")).toBe(true);
    expect(skillInstalls(added)).toHaveLength(1);
  });

  it("does not reconcile Agents that are not active", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await onSelfHost(t, addFromFolder, { projectId: PROJECT, files: seoPackage("0.0.1", "# v1\n") });

    expect(await t.action(internal.project_agents_node.reconcileInstanceAgents, { instanceId: PROJECT })).toEqual([]);
    expect(await commandsOf(t)).toHaveLength(0);
  });

  it("reconciles when a (re)provisioned Instance's runtime link is verified", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      await seedInstance(t);
      await onSelfHost(t, addFromFolder, { projectId: PROJECT, files: seoPackage("0.0.1", "# v1 marker\n") });
      await activate(t.withIdentity(OWNER));
      await t.run(async (ctx) => {
        const row = await ctx.db.query("instances").first();
        await ctx.db.patch(row!._id, { runtimeStatus: "created" });
      });
      const before = (await commandsOf(t)).length;

      await t.action(internal.instances_node.verifyRuntimeLinkForJob, { jobId: `job-${PROJECT}` });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const added = (await commandsOf(t)).slice(before);
      expect(workspaceWrites(added).some((w) => w.content === "# v1 marker\n")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes a Mission of the folder-installed SEO Template to to_validate without redeploying anything", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const as = t.withIdentity(OWNER);
    await onSelfHost(t, addFromFolder, { projectId: PROJECT, files: seoPackage("0.0.1", "# v1\n") });
    await activate(as);

    const { missionId } = await as.mutation(api.missions.create, {
      instanceId: PROJECT,
      templateId: "@acme/seo",
      type: "create_article",
      payload: { keyword: "octopus" },
      name: "Folder-installed SEO mission",
    });

    const dispatch = createMissionAwareDispatcher();
    const drain = async () =>
      t.run(async (ctx) => {
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
    await t.action(internal.mission_dispatcher_node.tick, {});
    await drain();
    await t.action(internal.mission_dispatcher_node.tick, {});
    await drain();
    await t.action(internal.mission_dispatcher_node.tick, {});

    const mission = (await t.run(async (ctx) => ctx.db.get(missionId))) as Doc<"missions">;
    expect(mission.status).toBe("to_validate");
  });

  describe("link mode", () => {
    it("updates the snapshot in place on each save, without a version bump, and pushes it to the Agent", async () => {
      const t = convexTest(schema, modules);
      await seedInstance(t);
      const as = t.withIdentity(OWNER);
      await onSelfHost(t, linkFromFolder, { projectId: PROJECT, files: seoPackage("0.0.1", "# v1\n") });
      await activate(as);
      const before = (await commandsOf(t)).length;

      const result = await onSelfHost(t, linkFromFolder, { projectId: PROJECT, files: seoPackage("0.0.1", "# edited marker\n") });

      expect(result.reconciled).toEqual([{ templateId: "@acme/seo", status: "refreshed" }]);
      expect(workspaceWrites((await commandsOf(t)).slice(before)).some((w) => w.content === "# edited marker\n")).toBe(true);
      const stored = await t.run(async (ctx) => ctx.db.query("installedTemplates").collect());
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ origin: "linked_folder", version: "0.0.1", current: true });
      const files = await t.run(async (ctx) => ctx.db.query("templateFiles").collect());
      expect(files.find((f) => f.path === "workspace/AGENTS.md")?.content).toBe("# edited marker\n");
      expect(files.filter((f) => f.path === "workspace/AGENTS.md")).toHaveLength(1);
    });

    it("makes an earlier version current again when the folder returns to its content", async () => {
      const t = convexTest(schema, modules);
      await seedInstance(t);
      await onSelfHost(t, linkFromFolder, { projectId: PROJECT, files: seoPackage("0.0.1", "# one\n") });
      await onSelfHost(t, linkFromFolder, { projectId: PROJECT, files: seoPackage("0.0.2", "# two\n") });

      await onSelfHost(t, linkFromFolder, { projectId: PROJECT, files: seoPackage("0.0.1", "# one\n") });

      const rows = await t.run(async (ctx) => ctx.db.query("installedTemplates").collect());
      expect(rows.filter((r) => r.current).map((r) => r.version)).toEqual(["0.0.1"]);
    });

    it("shows the origin of the installed Templates, linked included", async () => {
      const t = convexTest(schema, modules);
      await seedInstance(t);
      const as = t.withIdentity(OWNER);
      await onSelfHost(t, linkFromFolder, { projectId: PROJECT, files: seoPackage("0.0.1", "# v1\n") });

      expect(await as.query(api.project_templates.origins, { projectId: PROJECT })).toEqual([
        { templateId: "@acme/seo", version: "0.0.1", origin: "linked_folder" },
      ]);
    });

    it("keeps the previous valid snapshot when an edit is invalid, and reports the problem", async () => {
      const t = convexTest(schema, modules);
      await seedInstance(t);
      await onSelfHost(t, linkFromFolder, { projectId: PROJECT, files: seoPackage("0.0.1", "# good\n") });
      const profile = seoPackage("0.0.1", "").find((f) => f.path === "profiles/opengroow.yml")!.content;
      const broken = withFile(seoPackage("0.0.1", "# broken\n"), "profiles/opengroow.yml", `${profile}categoryy: marketing\n`);

      await expect(onSelfHost(t, linkFromFolder, { projectId: PROJECT, files: broken })).rejects.toThrow(/categoryy/);

      const files = await t.run(async (ctx) => ctx.db.query("templateFiles").collect());
      expect(files.find((f) => f.path === "workspace/AGENTS.md")?.content).toBe("# good\n");
    });

    it("does not rewrite a version installed from a folder: a linked edit must not alter a pinned version", async () => {
      const t = convexTest(schema, modules);
      await seedInstance(t);
      await onSelfHost(t, addFromFolder, { projectId: PROJECT, files: seoPackage("0.0.1", "# installed\n") });

      await expect(
        onSelfHost(t, linkFromFolder, { projectId: PROJECT, files: seoPackage("0.0.1", "# linked\n") }),
      ).rejects.toThrow(/already installed/);
    });

    it("keeps a linked version immutable for a plain install, which must bump the version", async () => {
      const t = convexTest(schema, modules);
      await seedInstance(t);
      await onSelfHost(t, linkFromFolder, { projectId: PROJECT, files: seoPackage("0.0.1", "# linked\n") });

      await expect(
        onSelfHost(t, addFromFolder, { projectId: PROJECT, files: seoPackage("0.0.1", "# other\n") }),
      ).rejects.toThrow(/already installed/);
    });
  });
});
