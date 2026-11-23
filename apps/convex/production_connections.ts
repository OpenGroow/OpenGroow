import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel.js";
import { mutation, query, type QueryCtx } from "./_generated/server.js";
import type { AgentTemplate } from "@opengroow/agent-templates";
import { ownerIdFor, readOwnerId } from "./instance_ownership.js";
import { ownedRecipe } from "./production_recipes.js";
import { RECIPE_PROVIDER, validateConnectionTarget } from "./production_connection_rules.js";
import { compatibleWhenV } from "./production_validators.js";
import { getTemplateRegistry } from "./template_registry.js";

// Creative Connections (issue #137): a recipe offered to one Mission type of
// one installed Template. Every read and write resolves ownership through the
// Instance and validates the target against the installed manifest.

export const CONNECTION_LIST_CAP = 200;

/**
 * The installed versions of a Template a connection may target, newest first:
 * the staged one (offered, not applied yet), then the current one. A pilot can
 * connect to a staged version before it is applied.
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

const declaresProvider = (template: AgentTemplate, missionType: string) =>
  template.manifest.missionTypes?.find((t) => t.type === missionType)?.contextProviders?.includes(RECIPE_PROVIDER) === true;

/** A connection of the caller's Instance, or null (another Instance's one is "not found"). */
export async function ownedConnection(ctx: QueryCtx, instanceId: string, connectionId: Id<"productionConnections">) {
  const connection = await ctx.db.get(connectionId);
  return connection && connection.instanceId === instanceId ? connection : null;
}

/** A connection with the display names of its target, read from the installed manifest when it still declares it. */
async function view(ctx: QueryCtx, connection: Doc<"productionConnections">) {
  const installed = await ctx.db
    .query("installedTemplates")
    .withIndex("by_project_current_template", (q) =>
      q.eq("projectId", connection.instanceId).eq("current", true).eq("templateId", connection.templateId),
    )
    .unique();
  const manifest = installed?.manifest as { name?: string; missionTypes?: Array<{ type: string; label?: string }> } | undefined;
  return {
    _id: connection._id,
    recipeId: connection.recipeId,
    templateId: connection.templateId,
    missionType: connection.missionType,
    templateName: manifest?.name,
    missionTypeLabel: manifest?.missionTypes?.find((t) => t.type === connection.missionType)?.label,
    compatibleWhen: connection.compatibleWhen,
  };
}

/** Creates a connection; refused for a bad target or a duplicate. */
export const create = mutation({
  args: {
    instanceId: v.string(),
    recipeId: v.id("productionRecipes"),
    templateId: v.string(),
    missionType: v.string(),
    compatibleWhen: v.optional(compatibleWhenV),
  },
  handler: async (ctx, args) => {
    await ownerIdFor(ctx, args.instanceId);
    const recipe = await ownedRecipe(ctx, args.instanceId, args.recipeId);
    if (!recipe) throw new Error("Production Recipe not found");
    if (recipe.status === "archived") throw new Error("Cannot connect an archived Production Recipe");
    const versions = await installedVersions(ctx, args.instanceId, args.templateId);
    if (versions.length === 0) throw new Error(`Template "${args.templateId}" is not installed`);
    // The newest version declaring the provider decides; none declaring it gives the current one's refusal.
    const template = versions.find((t) => declaresProvider(t, args.missionType)) ?? versions[versions.length - 1]!;
    const compatibleWhen = args.compatibleWhen ?? {};
    validateConnectionTarget(template.manifest, args.missionType, compatibleWhen);
    const existing = await ctx.db
      .query("productionConnections")
      .withIndex("by_recipe_target", (q) => q.eq("recipeId", args.recipeId).eq("templateId", args.templateId).eq("missionType", args.missionType))
      .first();
    if (existing) throw new Error("This recipe is already connected to this Mission type");
    return await ctx.db.insert("productionConnections", {
      instanceId: args.instanceId,
      recipeId: args.recipeId,
      templateId: args.templateId,
      missionType: args.missionType,
      compatibleWhen,
    });
  },
});

/** Removes a connection. Missions already created keep their snapshot. */
export const remove = mutation({
  args: { instanceId: v.string(), connectionId: v.id("productionConnections") },
  handler: async (ctx, args) => {
    await ownerIdFor(ctx, args.instanceId);
    const connection = await ownedConnection(ctx, args.instanceId, args.connectionId);
    if (!connection) throw new Error("Creative Connection not found");
    await ctx.db.delete(args.connectionId);
    return null;
  },
});

/** A recipe's connections. */
export const list = query({
  args: { instanceId: v.string(), recipeId: v.id("productionRecipes") },
  handler: async (ctx, args) => {
    if ((await readOwnerId(ctx, args.instanceId)) === null) return [];
    if (!(await ownedRecipe(ctx, args.instanceId, args.recipeId))) return [];
    const rows = await ctx.db
      .query("productionConnections")
      .withIndex("by_recipe_target", (q) => q.eq("recipeId", args.recipeId))
      .take(CONNECTION_LIST_CAP);
    return await Promise.all(rows.map((row) => view(ctx, row)));
  },
});

/** One connection, or null for a stranger or another Instance's connection. */
export const get = query({
  args: { instanceId: v.string(), connectionId: v.id("productionConnections") },
  handler: async (ctx, args) => {
    if ((await readOwnerId(ctx, args.instanceId)) === null) return null;
    const connection = await ownedConnection(ctx, args.instanceId, args.connectionId);
    return connection ? await view(ctx, connection) : null;
  },
});

/**
 * The Mission types of the Project's installed Templates that declare the
 * `production-recipe` provider, with their select fields: what a connection
 * can target.
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
    const targets: Array<{
      templateId: string;
      templateName: string;
      missionType: string;
      label: string;
      selectFields: Array<{ key: string; label: string; options: Array<{ value: string; label: string }> }>;
    }> = [];
    for (const templateId of templateIds) {
      const offered = new Set<string>();
      // Newest version first: a Mission type is offered once, from the newest version declaring the provider.
      for (const template of await installedVersions(ctx, args.instanceId, templateId)) {
        for (const type of template.manifest.missionTypes ?? []) {
          if (offered.has(type.type) || !declaresProvider(template, type.type)) continue;
          offered.add(type.type);
          targets.push({
            templateId,
            templateName: template.manifest.name,
            missionType: type.type,
            label: type.label,
            selectFields: (type.fields ?? []).flatMap((f) =>
              f.type === "select" ? [{ key: f.key, label: f.label, options: f.options }] : [],
            ),
          });
        }
      }
    }
    return targets;
  },
});
