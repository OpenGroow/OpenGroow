import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel.js";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server.js";
import type { AgentTemplate } from "@opengroow/agent-templates";
import { utcDateOf } from "@opengroow/protocol/content-planning-pins";
import { ownerIdFor, readOwnerId } from "./instance_ownership.js";
import { isRecipeTarget, validateRecipeTarget } from "./production_recipe_rules.js";
import { getTemplateRegistry } from "./template_registry.js";
import { pauseForUnavailableRecipe, schedulesUsingRecipe } from "./schedule_recipes.js";

// Production Recipes (issue #137, ADR-088): a first-class entity of the Project, independent of any Creative
// Family. A recipe is an identity; each save appends an immutable Recipe Version. Every read and write resolves
// ownership through the Instance.

/** The most recipes listed for a Project, and versions listed for one recipe. */
export const RECIPE_LIST_CAP = 200;
export const VERSION_LIST_CAP = 200;

const contentArgs = {
  prompt: v.optional(v.string()),
  instructions: v.string(),
  constraints: v.array(v.string()),
};

export type RecipeContent = { prompt?: string; instructions: string; constraints: string[] };

/** Trims the content and drops blank constraint lines. */
export function cleanContent(args: RecipeContent): RecipeContent {
  const prompt = args.prompt?.trim();
  return {
    ...(prompt ? { prompt } : {}),
    instructions: args.instructions.trim(),
    constraints: args.constraints.map((c) => c.trim()).filter((c) => c !== ""),
  };
}

/**
 * The installed versions of a Template a recipe may target, newest first: the
 * staged one (offered, not applied yet), then the current one. A pilot can
 * write a recipe for a staged version before it is applied.
 */
async function installedVersions(ctx: QueryCtx, instanceId: string, templateId: string): Promise<AgentTemplate[]> {
  const registry = getTemplateRegistry(ctx);
  const staged = await ctx.db
    .query("installedTemplates")
    .withIndex("by_project_template_staged", (q) => q.eq("projectId", instanceId).eq("templateId", templateId).eq("staged", true))
    .take(10);
  const templates: AgentTemplate[] = [];
  for (const row of staged) {
    const template = await registry.resolve(instanceId, templateId, row.version);
    if (template) templates.push(template);
  }
  const current = await registry.resolve(instanceId, templateId);
  if (current) templates.push(current);
  return templates;
}

/**
 * Throws unless an installed version of the Template has this Mission type and it is creative there (ADR-091).
 * The one target rule, shared by Recipe creation and Recipe Generation.
 */
export async function requireValidTarget(ctx: QueryCtx, instanceId: string, templateId: string, missionType: string) {
  const versions = await installedVersions(ctx, instanceId, templateId);
  if (versions.length === 0) throw new Error(`Template "${templateId}" is not installed`);
  // The newest version where the type is creative decides; none gives the current version's refusal.
  const template = versions.find((t) => isRecipeTarget(t.manifest, missionType)) ?? versions[versions.length - 1]!;
  validateRecipeTarget(template.manifest, missionType);
}

/** A recipe of the caller's Instance, or null (another Instance's recipe is "not found"). */
export async function ownedRecipe(ctx: QueryCtx, instanceId: string, recipeId: Id<"productionRecipes">) {
  const recipe = await ctx.db.get(recipeId);
  return recipe && recipe.instanceId === instanceId ? recipe : null;
}

async function requireOwnedRecipe(ctx: QueryCtx, instanceId: string, recipeId: Id<"productionRecipes">) {
  const recipe = await ownedRecipe(ctx, instanceId, recipeId);
  if (!recipe) throw new Error("Production Recipe not found");
  return recipe;
}

/** The newest version of a recipe, or null. */
export async function latestVersion(ctx: QueryCtx, recipeId: Id<"productionRecipes">) {
  return await ctx.db
    .query("productionRecipeVersions")
    .withIndex("by_recipe_version", (q) => q.eq("recipeId", recipeId))
    .order("desc")
    .first();
}

export async function appendVersion(ctx: MutationCtx, recipe: Doc<"productionRecipes">, content: RecipeContent) {
  const latest = await latestVersion(ctx, recipe._id);
  const version = (latest?.version ?? 0) + 1;
  await ctx.db.insert("productionRecipeVersions", {
    instanceId: recipe.instanceId,
    recipeId: recipe._id,
    version,
    ...content,
    createdAt: Date.now(),
  });
  return version;
}

/** Why a Bundled Recipe cannot be changed in place, or null for a Custom Recipe (ADR-091). */
function bundledRefusal(recipe: Doc<"productionRecipes">, action: string): string | null {
  return recipe.bundledId === undefined
    ? null
    : `A Bundled Recipe cannot be ${action}: it comes from its Template. Duplicate it to get a Custom Recipe you can change`;
}

function requireCustom(recipe: Doc<"productionRecipes">, action: string) {
  const refusal = bundledRefusal(recipe, action);
  if (refusal) throw new Error(refusal);
}

/** Where a recipe comes from, and whether it is the Default Recipe of its Mission type. */
export const originOf = (recipe: Doc<"productionRecipes">) => ({
  origin: recipe.bundledId === undefined ? ("custom" as const) : ("bundled" as const),
  isDefault: recipe.bundledId !== undefined && recipe.isDefault === true,
});

function recipeView(recipe: Doc<"productionRecipes">) {
  return {
    ...originOf(recipe),
    _id: recipe._id,
    createdAt: recipe._creationTime,
    templateId: recipe.templateId,
    missionType: recipe.missionType,
    name: recipe.name,
    description: recipe.description,
  };
}

function versionView(version: Doc<"productionRecipeVersions">) {
  return {
    version: version.version,
    prompt: version.prompt,
    instructions: version.instructions,
    constraints: version.constraints,
    createdAt: version.createdAt,
  };
}

/** The Run holding a Recipe Proposal of this Project that has created no Recipe yet, or throws. */
async function requireOpenProposal(ctx: QueryCtx, instanceId: string, runId: Id<"runs">) {
  const run = await ctx.db.get(runId);
  if (!run || run.instanceId !== instanceId || !("recipeGeneration" in run)) throw new Error("Recipe Proposal not found");
  if (!run.recipeProposal || typeof run.recipeProposal !== "object" || !("proposal" in run.recipeProposal)) throw new Error("This generation holds no Recipe Proposal");
  if (run.recipeId) throw new Error("A Production Recipe was already created from this Recipe Proposal");
  return run;
}

/** Creates a recipe with its version 1. */
export const create = mutation({
  args: {
    instanceId: v.string(),
    templateId: v.string(),
    missionType: v.string(),
    name: v.string(),
    description: v.string(),
    ...contentArgs,
    // Set when saving a Recipe Proposal (ADR-087): ties the creation to its Run, at most once.
    proposalRunId: v.optional(v.id("runs")),
  },
  handler: async (ctx, args) => {
    await ownerIdFor(ctx, args.instanceId);
    const name = args.name.trim().replace(/\s+/g, " ");
    if (name === "") throw new Error("A Production Recipe needs a name");
    const content = cleanContent(args);
    await requireValidTarget(ctx, args.instanceId, args.templateId, args.missionType);
    const proposalRun = args.proposalRunId ? await requireOpenProposal(ctx, args.instanceId, args.proposalRunId) : null;
    const recipeId = await ctx.db.insert("productionRecipes", {
      instanceId: args.instanceId,
      templateId: args.templateId,
      missionType: args.missionType,
      name,
      description: args.description.trim(),
    });
    const recipe = (await ctx.db.get(recipeId))!;
    const version = await appendVersion(ctx, recipe, content);
    if (proposalRun) await ctx.db.patch(proposalRun._id, { recipeId });
    return { recipeId, version };
  },
});

/** Appends the next Recipe Version; earlier versions are never changed. */
export const saveVersion = mutation({
  args: { instanceId: v.string(), recipeId: v.id("productionRecipes"), ...contentArgs },
  handler: async (ctx, args) => {
    await ownerIdFor(ctx, args.instanceId);
    const recipe = await requireOwnedRecipe(ctx, args.instanceId, args.recipeId);
    requireCustom(recipe, "edited");
    return await appendVersion(ctx, recipe, cleanContent(args));
  },
});

/** Changes the Mission type a recipe is written for. Existing Missions keep their snapshot. */
export const setTarget = mutation({
  args: { instanceId: v.string(), recipeId: v.id("productionRecipes"), templateId: v.string(), missionType: v.string() },
  handler: async (ctx, args) => {
    await ownerIdFor(ctx, args.instanceId);
    const recipe = await requireOwnedRecipe(ctx, args.instanceId, args.recipeId);
    requireCustom(recipe, "retargeted");
    await requireValidTarget(ctx, args.instanceId, args.templateId, args.missionType);
    await ctx.db.patch(args.recipeId, { templateId: args.templateId, missionType: args.missionType });
    // A Schedule using it has no compatible recipe any more when the target changed.
    for (const schedule of await schedulesUsingRecipe(ctx, args.recipeId)) {
      if (schedule.templateId !== args.templateId || schedule.type !== args.missionType) await pauseForUnavailableRecipe(ctx, schedule);
    }
    return null;
  },
});

/**
 * Copies the latest version of a recipe into a new, independent Custom Recipe for the same Recipe target. The copy
 * keeps no link to its source: editing either never changes the other.
 */
export const duplicate = mutation({
  args: { instanceId: v.string(), recipeId: v.id("productionRecipes"), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await ownerIdFor(ctx, args.instanceId);
    const source = await requireOwnedRecipe(ctx, args.instanceId, args.recipeId);
    const latest = await latestVersion(ctx, source._id);
    if (!latest) throw new Error("This Production Recipe has no version to duplicate");
    await requireValidTarget(ctx, args.instanceId, source.templateId, source.missionType);
    const name = (args.name ?? `${source.name} (copy)`).trim().replace(/\s+/g, " ");
    if (name === "") throw new Error("A Production Recipe needs a name");
    const recipeId = await ctx.db.insert("productionRecipes", {
      instanceId: args.instanceId,
      templateId: source.templateId,
      missionType: source.missionType,
      name,
      description: source.description,
    });
    const recipe = (await ctx.db.get(recipeId))!;
    await appendVersion(ctx, recipe, cleanContent(latest));
    return { recipeId };
  },
});

const idArgs = { instanceId: v.string(), recipeId: v.id("productionRecipes") };

/**
 * The Planned Contents not produced yet that use a recipe: a proposal of the draft plan, or an approved content whose
 * date has not passed. They hold only the recipe id, no Recipe Snapshot (the snapshot is taken when a Mission is
 * created), so they go with the recipe. A rejected content, or one dated in the past, stays as history.
 */
async function pendingPlannedContents(ctx: QueryCtx, recipeId: Id<"productionRecipes">) {
  const [proposed, approved] = await Promise.all([
    ctx.db.query("plannedContents").withIndex("by_recipe_status_plannedAt", (q) => q.eq("recipeId", recipeId).eq("status", "proposed")).collect(),
    ctx.db
      .query("plannedContents")
      .withIndex("by_recipe_status_plannedAt", (q) => q.eq("recipeId", recipeId).eq("status", "approved").gte("plannedAt", utcDateOf(Date.now())))
      .collect(),
  ]);
  return [...proposed, ...approved];
}

/** What deleting a recipe also deletes, for the confirmation: the number of its Planned Contents not produced yet. */
export const deletionImpact = query({
  args: idArgs,
  handler: async (ctx, args) => {
    if ((await readOwnerId(ctx, args.instanceId)) === null) return null;
    if (!(await ownedRecipe(ctx, args.instanceId, args.recipeId))) return null;
    const schedules = (await schedulesUsingRecipe(ctx, args.recipeId)).map((s) => ({ scheduleId: s._id, type: s.type }));
    return { plannedContents: (await pendingPlannedContents(ctx, args.recipeId)).length, schedules };
  },
});

/**
 * Deletes a recipe, its versions and its Planned Contents not produced yet, in one transaction. Missions made with it
 * keep their Recipe Snapshot: they run, retry and resume from it, and their Publications stay attributed. The Recipe
 * Proposal that created it stays marked as created (it cannot create a second one).
 */
export const remove = mutation({
  args: idArgs,
  handler: async (ctx, a) => {
    await ownerIdFor(ctx, a.instanceId);
    requireCustom(await requireOwnedRecipe(ctx, a.instanceId, a.recipeId), "deleted");
    // The Schedules using it pause as "recipe unavailable" and cannot resume until a compatible recipe is set.
    for (const schedule of await schedulesUsingRecipe(ctx, a.recipeId)) await pauseForUnavailableRecipe(ctx, schedule);
    for (const content of await pendingPlannedContents(ctx, a.recipeId)) await ctx.db.delete(content._id);
    const versions = await ctx.db.query("productionRecipeVersions").withIndex("by_recipe_version", (q) => q.eq("recipeId", a.recipeId)).collect();
    for (const version of versions) await ctx.db.delete(version._id);
    await ctx.db.delete(a.recipeId);
    return null;
  },
});

/** The Project's recipes with their latest version number. */
export const list = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    if ((await readOwnerId(ctx, args.instanceId)) === null) return [];
    const recipes = await ctx.db
      .query("productionRecipes")
      .withIndex("by_instance_target", (q) => q.eq("instanceId", args.instanceId))
      .take(RECIPE_LIST_CAP);
    return await Promise.all(
      recipes.map(async (recipe) => ({ ...recipeView(recipe), latestVersion: (await latestVersion(ctx, recipe._id))?.version ?? 0 })),
    );
  },
});

/**
 * The recipes written for one Mission type of one Template: what the Create
 * Mission form offers. Nothing is chosen automatically.
 */
export const listForMissionType = query({
  args: { instanceId: v.string(), templateId: v.string(), missionType: v.string() },
  handler: async (ctx, args) => {
    if ((await readOwnerId(ctx, args.instanceId)) === null) return [];
    const recipes = await ctx.db
      .query("productionRecipes")
      .withIndex("by_instance_target", (q) =>
        q.eq("instanceId", args.instanceId).eq("templateId", args.templateId).eq("missionType", args.missionType),
      )
      .take(RECIPE_LIST_CAP);
    return await Promise.all(
      recipes.map(async (recipe) => ({
        ...originOf(recipe),
        _id: recipe._id,
        name: recipe.name,
        description: recipe.description,
        latestVersion: (await latestVersion(ctx, recipe._id))?.version ?? 0,
      })),
    );
  },
});

/** One recipe with its latest version, or null for a stranger or another Instance's recipe. */
export const get = query({
  args: idArgs,
  handler: async (ctx, args) => {
    if ((await readOwnerId(ctx, args.instanceId)) === null) return null;
    const recipe = await ownedRecipe(ctx, args.instanceId, args.recipeId);
    if (!recipe) return null;
    const latest = await latestVersion(ctx, recipe._id);
    return { ...recipeView(recipe), latest: latest ? versionView(latest) : null };
  },
});

/** Every version of a recipe, newest first. */
export const listVersions = query({
  args: idArgs,
  handler: async (ctx, args) => {
    if ((await readOwnerId(ctx, args.instanceId)) === null) return [];
    if (!(await ownedRecipe(ctx, args.instanceId, args.recipeId))) return [];
    const versions = await ctx.db
      .query("productionRecipeVersions")
      .withIndex("by_recipe_version", (q) => q.eq("recipeId", args.recipeId))
      .order("desc")
      .take(VERSION_LIST_CAP);
    return versions.map(versionView);
  },
});

/**
 * The Mission types of the Project's installed Templates that declare the
 * creative: what a recipe can be written for.
 */
export const listTargets = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    if ((await readOwnerId(ctx, args.instanceId)) === null) return [];
    const current = await ctx.db
      .query("installedTemplates")
      .withIndex("by_project_current_template", (q) => q.eq("projectId", args.instanceId).eq("current", true))
      .take(100);
    const staged = await ctx.db
      .query("installedTemplates")
      .withIndex("by_project_staged", (q) => q.eq("projectId", args.instanceId).eq("staged", true))
      .take(100);
    const templateIds = [...new Set([...current, ...staged].map((row) => row.templateId))];
    const targets: Array<{ templateId: string; templateName: string; missionType: string; label: string }> = [];
    for (const templateId of templateIds) {
      const offered = new Set<string>();
      // Newest version first: a Mission type is offered once, from the newest version that is creative.
      for (const template of await installedVersions(ctx, args.instanceId, templateId)) {
        for (const type of template.manifest.missionTypes ?? []) {
          if (offered.has(type.type) || !isRecipeTarget(template.manifest, type.type)) continue;
          offered.add(type.type);
          targets.push({ templateId, templateName: template.manifest.name, missionType: type.type, label: type.label });
        }
      }
    }
    return targets;
  },
});
