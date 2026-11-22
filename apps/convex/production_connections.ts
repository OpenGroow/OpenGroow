import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel.js";
import { mutation, query, type QueryCtx } from "./_generated/server.js";
import { ownerIdFor, readOwnerId } from "./instance_ownership.js";
import { ownedRecipe } from "./production_recipes.js";
import { RECIPE_PROVIDER, validateConnectionTarget } from "./production_connection_rules.js";
import { getTemplateRegistry } from "./template_registry.js";

// Creative Connections (issue #137): a recipe offered to one Mission type of
// one installed Template. Every read and write resolves ownership through the
// Instance and validates the target against the installed manifest.

export const CONNECTION_LIST_CAP = 200;

const statusV = v.union(v.literal("candidate"), v.literal("active"), v.literal("disabled"));
const compatibleWhenV = v.record(v.string(), v.array(v.string()));

/** A connection of the caller's Instance, or null (another Instance's one is "not found"). */
export async function ownedConnection(ctx: QueryCtx, instanceId: string, connectionId: Id<"productionConnections">) {
  const connection = await ctx.db.get(connectionId);
  return connection && connection.instanceId === instanceId ? connection : null;
}

function view(connection: Doc<"productionConnections">) {
  return {
    _id: connection._id,
    recipeId: connection.recipeId,
    templateId: connection.templateId,
    missionType: connection.missionType,
    compatibleWhen: connection.compatibleWhen,
    status: connection.status,
  };
}

/** Creates a connection (default status `candidate`); refused for a bad target or a duplicate. */
export const create = mutation({
  args: {
    instanceId: v.string(),
    recipeId: v.id("productionRecipes"),
    templateId: v.string(),
    missionType: v.string(),
    compatibleWhen: v.optional(compatibleWhenV),
    status: v.optional(statusV),
  },
  handler: async (ctx, args) => {
    await ownerIdFor(ctx, args.instanceId);
    const recipe = await ownedRecipe(ctx, args.instanceId, args.recipeId);
    if (!recipe) throw new Error("Production Recipe not found");
    if (recipe.status === "archived") throw new Error("Cannot connect an archived Production Recipe");
    const template = await getTemplateRegistry(ctx).resolve(args.instanceId, args.templateId);
    if (!template) throw new Error(`Template "${args.templateId}" is not installed`);
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
      status: args.status ?? "candidate",
    });
  },
});

/** Changes a connection's status (activation is manual). */
export const setStatus = mutation({
  args: { instanceId: v.string(), connectionId: v.id("productionConnections"), status: statusV },
  handler: async (ctx, args) => {
    await ownerIdFor(ctx, args.instanceId);
    const connection = await ownedConnection(ctx, args.instanceId, args.connectionId);
    if (!connection) throw new Error("Creative Connection not found");
    if (connection.status !== args.status) await ctx.db.patch(args.connectionId, { status: args.status });
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
    return rows.map(view);
  },
});

/** One connection, or null for a stranger or another Instance's connection. */
export const get = query({
  args: { instanceId: v.string(), connectionId: v.id("productionConnections") },
  handler: async (ctx, args) => {
    if ((await readOwnerId(ctx, args.instanceId)) === null) return null;
    const connection = await ownedConnection(ctx, args.instanceId, args.connectionId);
    return connection ? view(connection) : null;
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
    const installed = await ctx.db
      .query("installedTemplates")
      .withIndex("by_project_current_template", (q) => q.eq("projectId", args.instanceId).eq("current", true))
      .take(100);
    const registry = getTemplateRegistry(ctx);
    const targets: Array<{
      templateId: string;
      templateName: string;
      missionType: string;
      label: string;
      selectFields: Array<{ key: string; label: string; options: Array<{ value: string; label: string }> }>;
    }> = [];
    for (const row of installed) {
      const template = await registry.resolve(args.instanceId, row.templateId);
      for (const type of template?.manifest.missionTypes ?? []) {
        if (!type.contextProviders?.includes(RECIPE_PROVIDER)) continue;
        targets.push({
          templateId: row.templateId,
          templateName: template!.manifest.name,
          missionType: type.type,
          label: type.label,
          selectFields: (type.fields ?? []).flatMap((f) =>
            f.type === "select" ? [{ key: f.key, label: f.label, options: f.options }] : [],
          ),
        });
      }
    }
    return targets;
  },
});
