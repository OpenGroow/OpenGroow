import { v } from "convex/values";
import { clawPackageToTemplate, isTemplateVersionRunnable, type AgentTemplate } from "@opengroow/agent-templates";
import { internalMutation, type MutationCtx } from "./_generated/server.js";
import type { Doc } from "./_generated/dataModel.js";
import { appendVersion, cleanContent, latestVersion, type RecipeContent } from "./production_recipes.js";
import { findSnapshot, toClawFiles } from "./template_registry_store.js";

// Provisioning of Bundled Recipes (ADR-091): the one idempotent function that makes a Project's recipes match what
// its current Template version ships. Called by every install path, on applying a staged update, on Agent
// activation and by the backfill. Creating a Mission never calls it.

export type ProvisionResult = { created: number; versionsAdded: number; becameCustom: number };

const sameContent = (a: RecipeContent, b: RecipeContent) =>
  (a.prompt ?? "") === (b.prompt ?? "") &&
  a.instructions === b.instructions &&
  a.constraints.length === b.constraints.length &&
  a.constraints.every((constraint, i) => constraint === b.constraints[i]);

/**
 * Makes the Bundled Recipes of one Template match its manifest:
 * - a declared recipe absent from the Project is added with Version 1;
 * - a declared recipe whose file content changed gets exactly one new Version; unchanged content adds none;
 * - the Default mark follows the manifest;
 * - a Bundled Recipe the Template no longer ships becomes a Custom Recipe (its identity, versions, snapshots and
 *   references stay; only the Bundled and Default marks go);
 * - a Custom Recipe is never read or changed, so a returning Bundled Recipe gets a new row beside it.
 * A Template version below schemaVersion 2 (outdated) ships no recipes and is left alone.
 */
export async function provisionBundledRecipes(
  ctx: MutationCtx,
  args: { projectId: string; templateId: string; template: Pick<AgentTemplate, "manifest" | "recipes"> },
): Promise<ProvisionResult> {
  const result: ProvisionResult = { created: 0, versionsAdded: 0, becameCustom: 0 };
  if (!isTemplateVersionRunnable(args.template.manifest)) return result;
  const declared = args.template.recipes ?? [];

  // The Project's recipes of this Template: bounded by what the Project and the Template carry.
  const rows = await ctx.db
    .query("productionRecipes")
    .withIndex("by_instance_target", (q) => q.eq("instanceId", args.projectId).eq("templateId", args.templateId))
    .collect();
  const bundled = new Map<string, Doc<"productionRecipes">>();
  for (const row of rows) if (row.bundledId !== undefined) bundled.set(`${row.missionType}::${row.bundledId}`, row);

  for (const recipe of declared) {
    const key = `${recipe.missionType}::${recipe.id}`;
    const content = cleanContent(recipe);
    const existing = bundled.get(key);
    bundled.delete(key);
    if (!existing) {
      const recipeId = await ctx.db.insert("productionRecipes", {
        instanceId: args.projectId,
        templateId: args.templateId,
        missionType: recipe.missionType,
        name: recipe.name,
        description: recipe.description,
        bundledId: recipe.id,
        isDefault: recipe.default,
      });
      await appendVersion(ctx, (await ctx.db.get(recipeId))!, content);
      result.created += 1;
      continue;
    }
    if (existing.name !== recipe.name || existing.description !== recipe.description || (existing.isDefault ?? false) !== recipe.default) {
      await ctx.db.patch(existing._id, { name: recipe.name, description: recipe.description, isDefault: recipe.default });
    }
    const latest = await latestVersion(ctx, existing._id);
    if (!latest || !sameContent(content, cleanContent(latest))) {
      await appendVersion(ctx, existing, content);
      result.versionsAdded += 1;
    }
  }

  for (const retired of bundled.values()) {
    await ctx.db.patch(retired._id, { bundledId: undefined, isDefault: undefined });
    result.becameCustom += 1;
  }
  return result;
}

/** Provisions from the Template version currently installed in the Project, if any. */
export async function provisionCurrentTemplate(
  ctx: MutationCtx,
  projectId: string,
  templateId: string,
): Promise<ProvisionResult | null> {
  const snapshot = await findSnapshot(ctx, projectId, templateId);
  if (!snapshot) return null;
  const converted = clawPackageToTemplate(toClawFiles(snapshot.files));
  if (!converted.ok) return null;
  return await provisionBundledRecipes(ctx, { projectId, templateId, template: converted.template });
}

/** Agent activation: the recipes a Project lost track of (or never got) are provisioned again. */
export const provisionCurrent = internalMutation({
  args: { projectId: v.string(), templateId: v.string() },
  handler: async (ctx, args) => await provisionCurrentTemplate(ctx, args.projectId, args.templateId),
});
