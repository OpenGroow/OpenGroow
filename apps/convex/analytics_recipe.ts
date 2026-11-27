import type { QueryCtx } from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { readAttributed, type AttributedGroup } from "./analytics_attributed.js";

// Performance by Production Recipe (ADR-084): a Publication is attributed through its Mission's Recipe
// Snapshot, never through the live recipe, so editing, renaming or deleting a recipe does not move history.

export type RecipePerformance = Omit<AttributedGroup, "members"> & {
  recipeId: string;
  /** The name at the time of the Missions (from the snapshots), not the current one. */
  recipeName: string;
  /** Publications per recipe version used, oldest version first, each with its last publication date. */
  versions: Array<{ version: number; publications: number; lastPublishedAt: number }>;
};

export type RecipeSummary = {
  groupBy: "recipe";
  from: number;
  to: number;
  recipes: RecipePerformance[];
  /** Publications of the period whose Mission has no Recipe Snapshot: in no recipe group. */
  unattributed: number;
  scanLimited: boolean;
  oldestScannedCreatedAt?: number;
  partial: boolean;
};

/** The Project's Publications of the period, grouped by the recipe of their Mission's snapshot, optionally for one recipe. */
export async function summarizeByRecipe(
  ctx: Pick<QueryCtx, "db">,
  instanceId: string,
  window: { from: number; to: number },
  options: { scanLimit?: number; platform?: string; recipeId?: string; now?: number } = {},
): Promise<RecipeSummary> {
  const read = await readAttributed(ctx, instanceId, window, {
    keyOf: (mission) => mission.recipeSnapshot?.recipeId,
    // A recipe id of another Project (or no id at all) matches no snapshot of this one.
    keep: options.recipeId === undefined ? undefined : (key) => key === options.recipeId,
    scanLimit: options.scanLimit,
    platform: options.platform,
    now: options.now,
  });
  const recipes: RecipePerformance[] = [];
  for (const [recipeId, { members, ...group }] of read.groups) {
    const newest = members.reduce((a, m) => (m.publishedAt > a.publishedAt ? m : a));
    const versions = new Map<number, { publications: number; lastPublishedAt: number }>();
    for (const { mission, publishedAt } of members) {
      const version = mission.recipeSnapshot!.version;
      const known = versions.get(version) ?? { publications: 0, lastPublishedAt: 0 };
      known.publications += 1;
      known.lastPublishedAt = Math.max(known.lastPublishedAt, publishedAt);
      versions.set(version, known);
    }
    recipes.push({
      recipeId,
      recipeName: newest.mission.recipeSnapshot!.recipeName,
      ...group,
      versions: [...versions.entries()].sort(([a], [b]) => a - b).map(([version, v]) => ({ version, ...v })),
    });
  }
  recipes.sort((a, b) => b.lastPublishedAt - a.lastPublishedAt || a.recipeId.localeCompare(b.recipeId));
  return {
    groupBy: "recipe",
    from: window.from,
    to: window.to,
    recipes,
    unattributed: read.unattributed,
    scanLimited: read.scanLimited,
    ...(read.oldestScannedCreatedAt !== undefined ? { oldestScannedCreatedAt: read.oldestScannedCreatedAt } : {}),
    partial: read.scanLimited,
  };
}
