import { v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel.js";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server.js";
import { isActiveFamily, requireOwnedFamily } from "./creative_families.js";
import type { AgentTemplate } from "@opengroow/agent-templates";
import { ownerIdFor, readOwnerId } from "./instance_ownership.js";
import { type recipeStatusV } from "./production_validators.js";
import { declaresRecipeProvider, validateRecipeTarget } from "./production_recipe_rules.js";
import { getTemplateRegistry } from "./template_registry.js";

// Production Recipes under a Creative Family (issue #137). A recipe is an
// identity; each save appends an immutable Recipe Version. Every read and
// write resolves ownership through the Instance.

/** The most recipes listed under one family, and versions listed for one recipe. */
export const RECIPE_LIST_CAP = 200;
export const VERSION_LIST_CAP = 200;

const contentArgs = {
  prompt: v.optional(v.string()),
  instructions: v.string(),
  constraints: v.array(v.string()),
};

type RecipeContent = { prompt?: string; instructions: string; constraints: string[] };

/** Trims the content and drops blank constraint lines. */
function cleanContent(args: RecipeContent): RecipeContent {
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

/** Throws unless an installed version of the Template has this Mission type and it declares the provider. */
async function requireValidTarget(ctx: QueryCtx, instanceId: string, templateId: string, missionType: string) {
  const versions = await installedVersions(ctx, instanceId, templateId);
  if (versions.length === 0) throw new Error(`Template "${templateId}" is not installed`);
  // The newest version declaring the provider decides; none declaring it gives the current one's refusal.
  const template = versions.find((t) => declaresRecipeProvider(t.manifest, missionType)) ?? versions[versions.length - 1]!;
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

async function appendVersion(ctx: MutationCtx, recipe: Doc<"productionRecipes">, content: RecipeContent) {
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

function recipeView(recipe: Doc<"productionRecipes">) {
  return {
    _id: recipe._id,
    creativeFamilyId: recipe.creativeFamilyId,
    templateId: recipe.templateId,
    missionType: recipe.missionType,
    name: recipe.name,
    description: recipe.description,
    status: recipe.status,
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

/** Creates a recipe under an active family with its version 1. */
export const create = mutation({
  args: {
    instanceId: v.string(),
    familyId: v.id("creativeFamilies"),
    templateId: v.string(),
    missionType: v.string(),
    name: v.string(),
    description: v.string(),
    ...contentArgs,
  },
  handler: async (ctx, args) => {
    await ownerIdFor(ctx, args.instanceId);
    const family = await requireOwnedFamily(ctx, args.instanceId, args.familyId);
    if (!isActiveFamily(family)) throw new Error("Cannot add a Production Recipe to an archived Creative Family");
    const name = args.name.trim().replace(/\s+/g, " ");
    if (name === "") throw new Error("A Production Recipe needs a name");
    const content = cleanContent(args);
    await requireValidTarget(ctx, args.instanceId, args.templateId, args.missionType);
    const recipeId = await ctx.db.insert("productionRecipes", {
      instanceId: args.instanceId,
      creativeFamilyId: args.familyId,
      templateId: args.templateId,
      missionType: args.missionType,
      name,
      description: args.description.trim(),
      status: "active",
    });
    const recipe = (await ctx.db.get(recipeId))!;
    const version = await appendVersion(ctx, recipe, content);
    return { recipeId, version };
  },
});

/** Appends the next Recipe Version; earlier versions are never changed. */
export const saveVersion = mutation({
  args: { instanceId: v.string(), recipeId: v.id("productionRecipes"), ...contentArgs },
  handler: async (ctx, args) => {
    await ownerIdFor(ctx, args.instanceId);
    const recipe = await requireOwnedRecipe(ctx, args.instanceId, args.recipeId);
    if (recipe.status === "archived") throw new Error("An archived Production Recipe cannot be edited");
    return await appendVersion(ctx, recipe, cleanContent(args));
  },
});

/** Changes the Mission type a recipe is written for. Existing Missions keep their snapshot. */
export const setTarget = mutation({
  args: { instanceId: v.string(), recipeId: v.id("productionRecipes"), templateId: v.string(), missionType: v.string() },
  handler: async (ctx, args) => {
    await ownerIdFor(ctx, args.instanceId);
    const recipe = await requireOwnedRecipe(ctx, args.instanceId, args.recipeId);
    if (recipe.status === "archived") throw new Error("An archived Production Recipe cannot be edited");
    await requireValidTarget(ctx, args.instanceId, args.templateId, args.missionType);
    await ctx.db.patch(args.recipeId, { templateId: args.templateId, missionType: args.missionType });
    return null;
  },
});

async function setStatus(ctx: MutationCtx, instanceId: string, recipeId: Id<"productionRecipes">, status: Infer<typeof recipeStatusV>) {
  await ownerIdFor(ctx, instanceId);
  const recipe = await requireOwnedRecipe(ctx, instanceId, recipeId);
  if (recipe.status !== status) await ctx.db.patch(recipeId, { status });
  return null;
}

const idArgs = { instanceId: v.string(), recipeId: v.id("productionRecipes") };

/** Archives a recipe; its versions stay readable. */
export const archive = mutation({
  args: idArgs,
  handler: async (ctx, a) => await setStatus(ctx, a.instanceId, a.recipeId, "archived"),
});

export const unarchive = mutation({
  args: idArgs,
  handler: async (ctx, a) => await setStatus(ctx, a.instanceId, a.recipeId, "active"),
});

/** A family's recipes (archived included) with their latest version number. */
export const list = query({
  args: { instanceId: v.string(), familyId: v.id("creativeFamilies") },
  handler: async (ctx, args) => {
    if ((await readOwnerId(ctx, args.instanceId)) === null) return [];
    const recipes = await ctx.db
      .query("productionRecipes")
      .withIndex("by_instance_family", (q) => q.eq("instanceId", args.instanceId).eq("creativeFamilyId", args.familyId))
      .take(RECIPE_LIST_CAP);
    return await Promise.all(
      recipes.map(async (recipe) => ({ ...recipeView(recipe), latestVersion: (await latestVersion(ctx, recipe._id))?.version ?? 0 })),
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
 * `production-recipe` provider: what a recipe can be written for.
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
      // Newest version first: a Mission type is offered once, from the newest version declaring the provider.
      for (const template of await installedVersions(ctx, args.instanceId, templateId)) {
        for (const type of template.manifest.missionTypes ?? []) {
          if (offered.has(type.type) || !declaresRecipeProvider(template.manifest, type.type)) continue;
          offered.add(type.type);
          targets.push({ templateId, templateName: template.manifest.name, missionType: type.type, label: type.label });
        }
      }
    }
    return targets;
  },
});
