import type { QueryCtx } from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";
import { readAttributed, type AttributedGroup } from "./analytics_attributed.js";
import { summarizeByRecipe, type RecipePerformance } from "./analytics_recipe.js";

// Performance by Creative Family (ADR-084): a family is read from the union of its Publications, never from
// its recipes' figures. Attribution is Publication -> Recipe Snapshot -> recipe -> family. This relies on the
// invariant that a Production Recipe never changes Creative Family (tested in production_recipes.test.ts).

const MAX_RECIPES = 2000;

export type FamilyPerformance = Omit<AttributedGroup, "members"> & {
  familyId: string;
  familyName: string;
  /** The family is archived now (a merged family is archived). Its Publications stay attributed to it. */
  archived: boolean;
  /** Set on a family emptied by a merge: the family its Sources went to. Its Publications did not move. */
  mergedIntoId?: string;
  /** Each recipe's own result, over its own Publications of this family only. */
  recipes: RecipePerformance[];
};

export type FamilySummary = {
  groupBy: "family";
  from: number;
  to: number;
  families: FamilyPerformance[];
  /** Publications of the period with no Recipe Snapshot (or a recipe of no family of this Project): in no family group. */
  unattributed: number;
  scanLimited: boolean;
  oldestScannedCreatedAt?: number;
  partial: boolean;
};

export async function summarizeByFamily(
  ctx: Pick<QueryCtx, "db">,
  instanceId: string,
  window: { from: number; to: number },
  options: { scanLimit?: number; platform?: string; familyId?: string; now?: number } = {},
): Promise<FamilySummary> {
  const recipes = await ctx.db.query("productionRecipes").withIndex("by_instance_family", (q) => q.eq("instanceId", instanceId)).take(MAX_RECIPES);
  const familyOf = new Map<string, string>(recipes.map((r) => [r._id, r.creativeFamilyId]));
  const common = { scanLimit: options.scanLimit, platform: options.platform, now: options.now };
  const read = await readAttributed(ctx, instanceId, window, {
    // A snapshot of a recipe unknown to this Project has no family.
    keyOf: (mission) => familyOf.get(mission.recipeSnapshot?.recipeId ?? ""),
    keep: options.familyId === undefined ? undefined : (key) => key === options.familyId,
    ...common,
  });
  const byRecipe = read.groups.size === 0 ? undefined : await summarizeByRecipe(ctx, instanceId, window, common);
  const families: FamilyPerformance[] = [];
  for (const [familyId, { members: _members, ...group }] of read.groups) {
    const family = await ctx.db.get(familyId as Id<"creativeFamilies">);
    families.push({
      familyId,
      familyName: family?.name ?? "",
      archived: family?.status === "archived",
      ...(family?.mergedIntoId ? { mergedIntoId: family.mergedIntoId } : {}),
      ...group,
      recipes: (byRecipe?.recipes ?? []).filter((r) => familyOf.get(r.recipeId) === familyId),
    });
  }
  families.sort((a, b) => b.lastPublishedAt - a.lastPublishedAt || a.familyId.localeCompare(b.familyId));
  return {
    groupBy: "family",
    from: window.from,
    to: window.to,
    families,
    unattributed: read.unattributed,
    scanLimited: read.scanLimited,
    ...(read.oldestScannedCreatedAt !== undefined ? { oldestScannedCreatedAt: read.oldestScannedCreatedAt } : {}),
    partial: read.scanLimited,
  };
}
