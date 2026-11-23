import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import type { AgentTemplate } from "@opengroow/agent-templates";
import { createInMemoryTemplateRegistry } from "@opengroow/agent-templates/registry";
import { setTemplateRegistryForTests } from "../template_registry";
import { insertInstance } from "./instance_fixture";
import { fixtureTemplate } from "./helpers/template_registry.helpers";
import { appendContextProviders, renderProductionRecipeSection } from "../mission_dispatcher/context_providers";

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
  "../production_recipes.ts": () => import("../production_recipes.js"),
  "../production_connections.ts": () => import("../production_connections.js"),
};

const INSTANCE = "instance-mission-recipe";
const OTHER_INSTANCE = "instance-mission-recipe-other";
const TEMPLATE_ID = "@example/video";
const OWNER = { name: "Owner", email: "o@example.com", tokenIdentifier: "test|owner-mr", subject: "owner-mr" };
const STRANGER = { name: "S", email: "s@example.com", tokenIdentifier: "test|stranger-mr", subject: "stranger-mr" };

const missionType = (providers: string[]) => ({
  type: "create_letter_video",
  label: "Letter video",
  contextProviders: providers,
  fields: [
    { key: "format", label: "Format", type: "select", options: [{ value: "hook", label: "Hook" }, { value: "letter", label: "Letter" }] },
  ],
});

/** 1.0.0 is current and has no provider; 2.0.0 is staged and declares it. */
function templateVersion(label: string, providers: string[]): AgentTemplate {
  return {
    ...fixtureTemplate(TEMPLATE_ID, { missionTypes: [missionType(providers)] } as never),
    agentsMd: `# Base ${label}\n`,
    missionAgentsMd: { create_letter_video: `# Mission ${label}\n` },
  };
}

beforeEach(() => {
  setTemplateRegistryForTests(
    createInMemoryTemplateRegistry(
      [INSTANCE, OTHER_INSTANCE].flatMap((projectId) => [
        { projectId, version: "1.0.0", template: templateVersion("v1", []) },
        { projectId, version: "2.0.0", template: templateVersion("v2", ["production-recipe"]) },
      ]),
    ),
  );
});
afterEach(() => setTemplateRegistryForTests(undefined));

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, { jobId: "job-a", status: "running", runtimeStatus: "linked", runtimeReady: true, createdAt: now, openclawId: INSTANCE, updatedAt: now, userId: OWNER.subject });
    await insertInstance(ctx, { jobId: "job-b", status: "running", createdAt: now, openclawId: OTHER_INSTANCE, updatedAt: now, userId: STRANGER.subject });
    for (const [version, current] of [["1.0.0", true], ["2.0.0", false]] as const) {
      await ctx.db.insert("installedTemplates", {
        projectId: INSTANCE, templateId: TEMPLATE_ID, version, origin: "hub" as never, digest: "sha256:x",
        manifest: {}, current, ...(current ? {} : { staged: true }), installedAt: Date.now(),
      } as never);
    }
    const nowMs = Date.now();
    await ctx.db.insert("projectAgents", {
      instanceId: INSTANCE, templateId: TEMPLATE_ID, workspaceKey: "ws-mr", openclawAgentName: "video", status: "active",
      mcpServerKeys: [], createdAt: nowMs, updatedAt: nowMs,
    });
  });
  const familyId = await t.run((ctx) => ctx.db.insert("creativeFamilies", { instanceId: INSTANCE, slug: "s", name: "F", description: "d" } as never));
  const otherFamily = await t.run((ctx) => ctx.db.insert("creativeFamilies", { instanceId: OTHER_INSTANCE, slug: "s", name: "F", description: "d" } as never));
  const owner = t.withIdentity(OWNER);
  const stranger = t.withIdentity(STRANGER);

  async function recipe(instanceId = INSTANCE, family: Id<"creativeFamilies"> = familyId, as = owner) {
    const { recipeId } = await as.mutation(api.production_recipes.create, {
      instanceId, familyId: family, name: "Reaction", description: "",
      prompt: "A close-up, calm face.", instructions: "Write a calm hook.", constraints: ["No dialogue"],
    });
    return recipeId;
  }
  async function connect(recipeId: Id<"productionRecipes">, compatibleWhen: Record<string, string[]> = { format: ["hook"] }) {
    const connectionId = await owner.mutation(api.production_connections.create, {
      instanceId: INSTANCE, recipeId, templateId: TEMPLATE_ID, missionType: "create_letter_video", compatibleWhen,
    });
    return connectionId;
  }
  const create = (extra: Record<string, unknown>, payload: unknown = { format: "hook" }) =>
    owner.mutation(api.missions.create, { instanceId: INSTANCE, templateId: TEMPLATE_ID, type: "create_letter_video", payload, ...extra } as never);
  return { t, owner, stranger, recipe, connect, create, otherFamily };
}

describe("missions.create with a recipe", () => {
  it("stores the snapshot once, with the texts used", async () => {
    const { t, recipe, connect, create } = await setup();
    const connectionId = await connect(await recipe());
    const { missionId } = await create({ templateVersion: "2.0.0", recipe: { connectionId } });
    const mission = await t.run((ctx) => ctx.db.get(missionId));
    expect(mission?.templateVersion).toBe("2.0.0");
    expect(mission?.payload).toEqual({ format: "hook" });
    expect(mission?.recipeSnapshot).toMatchObject({
      recipeName: "Reaction", version: 1, connectionId,
      prompt: "A close-up, calm face.", instructions: "Write a calm hook.", constraints: ["No dialogue"],
    });
  });

  it("accepts an active connection, and an older version", async () => {
    const { owner, t, recipe, connect, create } = await setup();
    const recipeId = await recipe();
    await owner.mutation(api.production_recipes.saveVersion, {
      instanceId: INSTANCE, recipeId, prompt: "Second take", instructions: "i", constraints: [],
    });
    const connectionId = await connect(recipeId);
    const latest = await create({ templateVersion: "2.0.0", recipe: { connectionId } });
    const older = await create({ templateVersion: "2.0.0", recipe: { connectionId, version: 1 } });
    const snaps = await t.run(async (ctx) => [(await ctx.db.get(latest.missionId))?.recipeSnapshot, (await ctx.db.get(older.missionId))?.recipeSnapshot]);
    expect(snaps[0]).toMatchObject({ version: 2, prompt: "Second take" });
    expect(snaps[1]?.version).toBe(1);
    expect(snaps[1]?.prompt).toBe("A close-up, calm face.");
  });

  it("refuses a stranger's connection", async () => {
    const { recipe, connect, create, stranger } = await setup();
    const connectionId = await connect(await recipe());
    await expect(
      stranger.mutation(api.missions.create, { instanceId: OTHER_INSTANCE, templateId: TEMPLATE_ID, type: "create_letter_video", payload: { format: "hook" }, recipe: { connectionId } } as never),
    ).rejects.toThrow(/not found/);
  });

  it("refuses a connection that targets another Mission type", async () => {
    const { recipe, connect, owner } = await setup();
    const connectionId = await connect(await recipe());
    await expect(
      owner.mutation(api.missions.create, { instanceId: INSTANCE, templateId: "@example/other", type: "create_letter_video", payload: { format: "hook" }, recipe: { connectionId } } as never),
    ).rejects.toThrow(/does not target/);
    await expect(
      owner.mutation(api.missions.create, { instanceId: INSTANCE, templateId: TEMPLATE_ID, type: "other_type", payload: { format: "hook" }, recipe: { connectionId } } as never),
    ).rejects.toThrow(/does not target/);
  });

  it("refuses an incompatible payload", async () => {
    const { recipe, connect, create } = await setup();
    const connectionId = await connect(await recipe());
    await expect(create({ templateVersion: "2.0.0", recipe: { connectionId } }, { format: "letter" })).rejects.toThrow(/compatib/i);
  });

  it("refuses a pinned version that does not declare the provider", async () => {
    const { recipe, connect, create } = await setup();
    const connectionId = await connect(await recipe());
    // No templateVersion: the Mission pins the current 1.0.0.
    await expect(create({ recipe: { connectionId } })).rejects.toThrow(/production-recipe/);
  });

  it("refuses an archived recipe", async () => {
    const { owner, recipe, connect, create } = await setup();
    const recipeId = await recipe();
    const connectionId = await connect(recipeId);
    await owner.mutation(api.production_recipes.archive, { instanceId: INSTANCE, recipeId });
    await expect(create({ templateVersion: "2.0.0", recipe: { connectionId } })).rejects.toThrow(/archived/);
  });

  it("refuses an unknown version", async () => {
    const { recipe, connect, create } = await setup();
    const connectionId = await connect(await recipe());
    await expect(create({ templateVersion: "2.0.0", recipe: { connectionId, version: 9 } })).rejects.toThrow(/version/i);
  });

  it("creates nothing when the creation is refused", async () => {
    const { t, recipe, connect, create } = await setup();
    const connectionId = await connect(await recipe());
    await create({ templateVersion: "2.0.0", recipe: { connectionId, version: 9 } }).catch(() => undefined);
    expect(await t.run((ctx) => ctx.db.query("missions").collect())).toHaveLength(0);
  });
});

describe("missions.create templateVersion", () => {
  it("pins a staged installed version and dispatches on it", async () => {
    const { t, create } = await setup();
    const { missionId, runId } = await create({ templateVersion: "2.0.0" });
    expect((await t.run((ctx) => ctx.db.get(missionId)))?.templateVersion).toBe("2.0.0");
    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});
    const files = await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const command = await ctx.db.get(run!.dispatchCommandId!);
      return (command!.payload as { filesToWrite: Array<{ filePath: string; content: string }> }).filesToWrite;
    });
    expect(files.find((f) => f.filePath === "AGENTS.md")!.content).toContain("Base v2");
  });

  it("pins the current version when omitted", async () => {
    const { t, create } = await setup();
    const { missionId } = await create({});
    expect((await t.run((ctx) => ctx.db.get(missionId)))?.templateVersion).toBe("1.0.0");
  });

  it("refuses a version that is not installed", async () => {
    const { create } = await setup();
    await expect(create({ templateVersion: "9.9.9" })).rejects.toThrow(/not installed/);
  });
});

describe("Recipe Snapshot in context.md", () => {
  async function dispatched(t: Awaited<ReturnType<typeof setup>>["t"], runId: Id<"runs">) {
    return await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const command = await ctx.db.get(run!.dispatchCommandId!);
      const files = (command!.payload as { filesToWrite: Array<{ filePath: string; content: string }> }).filesToWrite;
      return files.find((f) => f.filePath.endsWith("context.md"))!.content;
    });
  }

  it("renders the same section for every Run, unchanged by a new version or archiving", async () => {
    const { t, owner, recipe, connect, create } = await setup();
    const recipeId = await recipe();
    const connectionId = await connect(recipeId);
    const { missionId, runId } = await create({ templateVersion: "2.0.0", recipe: { connectionId } });
    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});
    const first = await dispatched(t, runId);
    expect(first).toContain("# Production Recipe");
    expect(first).toContain("A close-up, calm face.");

    await owner.mutation(api.production_recipes.saveVersion, {
      instanceId: INSTANCE, recipeId, prompt: "Changed", instructions: "Changed", constraints: [],
    });
    await owner.mutation(api.production_recipes.archive, { instanceId: INSTANCE, recipeId });
    await t.run((ctx) => ctx.db.patch(runId, { status: "failed" }));
    const retry = await t.run((ctx) => ctx.db.insert("runs", {
      missionId, ownerId: OWNER.subject, instanceId: INSTANCE, templateId: TEMPLATE_ID, agentName: "video",
      sessionKey: "mega-retry", status: "pending", createdAt: Date.now(), updatedAt: Date.now(),
    }));
    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});
    const section = (md: string) => md.slice(md.indexOf("# Production Recipe"));
    expect(section(await dispatched(t, retry))).toBe(section(first));
  });

  it("leaves a Mission without a recipe unchanged", async () => {
    const { t, create } = await setup();
    const { runId } = await create({ templateVersion: "2.0.0" });
    await t.action(internal.mission_dispatcher_node.dispatchPendingRuns, {});
    expect(await dispatched(t, runId)).not.toContain("Production Recipe");
  });
});

describe("renderProductionRecipeSection", () => {
  const snapshot = {
    recipeName: "Reaction", version: 3,
    prompt: "A calm face.", instructions: "Write a hook.", constraints: ["No dialogue", "Calm"],
  };
  it("renders every subsection and the precedence statement", () => {
    const md = renderProductionRecipeSection(snapshot)!;
    expect(md).toContain("# Production Recipe");
    expect(md).toContain("Reaction (version 3)");
    expect(md).toContain("## Prompt (verbatim)");
    expect(md).toContain("A calm face.");
    expect(md).toContain("## Instructions\n\nWrite a hook.");
    expect(md).toContain("## Constraints\n\n- No dialogue\n- Calm");
    expect(md).not.toContain("## Variables");
    expect(md).toMatch(/technical instructions[\s\S]*Brand Core[\s\S]*take precedence/);
  });
  it("omits the prompt subsection without a prompt and renders nothing without a snapshot", () => {
    expect(renderProductionRecipeSection({ ...snapshot, prompt: undefined })).not.toContain("Prompt (verbatim)");
    expect(renderProductionRecipeSection(null)).toBeNull();
    expect(appendContextProviders("base", ["production-recipe"], { "production-recipe": null })).toBe("base");
  });
  it("keeps a prompt containing backticks verbatim", () => {
    const md = renderProductionRecipeSection({ ...snapshot, prompt: "use ``` fences" })!;
    expect(md).toContain("````\nuse ``` fences\n````");
  });
});
