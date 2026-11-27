import type { QueryCtx } from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { linkedAdapters } from "./analytics_adapters.js";
import { claimStatus, measurementClaims } from "./analytics_claims.js";
import { originOf } from "./production_recipes.js";
import { publicationsInWindow, SCAN_LIMIT } from "./analytics_window.js";

// The Production Recipe catalog with its usage history (ADR-084, issue #158), read through the
// Internal MCP. Computed on read from Missions, Runs and Publications; nothing is stored. Marketing
// performance stays on the Analytics page, usage stays here.

const MAX_RECIPES = 300;
const RUNS_PER_MISSION = 100;
const MISSION_STATUSES = ["todo", "doing", "blocked", "to_validate", "approved", "done", "failed", "cancelled"] as const;

type Counts = { missions: number; productionAttempts: number; successfulAttempts: number; publications: number; measuredPublications: number };
const empty = (): Counts => ({ missions: 0, productionAttempts: 0, successfulAttempts: 0, publications: 0, measuredPublications: 0 });

type Usage = { lifetime: Counts; period: Counts; lastMissionAt?: number; lastAttemptAt?: number; lastPublicationAt?: number };

export type RecipeCatalog = {
  from: number;
  to: number;
  recipes: Array<{
    recipeId: string;
    name: string;
    description: string;
    missionType: string;
    templateId: string;
    /** Bundled: shipped by its Template, read-only. Custom: written in the Project. */
    origin: "bundled" | "custom";
    /** The Default Recipe of its Mission type (always a Bundled Recipe). */
    isDefault: boolean;
    usage: Usage;
    /** Absent (unknown) when the Missions read was incomplete and none was seen. */
    neverUsedEver?: boolean;
    /** Absent (unknown) when the Publications read was incomplete and none was seen. */
    neverPublishedEver?: boolean;
  }>;
  total: number;
  /** The list was cut at its size limit (or the Project has more recipes than were read). */
  truncated: boolean;
  missionsScanLimited: boolean;
  publicationsScanLimited: boolean;
  /** Creation date of the oldest Publication read; present only when its read was limited. */
  oldestScannedCreatedAt?: number;
  /** Some counters or flags rest on an incomplete read. */
  partial: boolean;
};

/** A Run sent to its Agent is a Production Attempt; a successful one finished with a result. */
const isAttempt = (run: Doc<"runs">) => run.dispatchedAt !== undefined;
const isSuccessful = (run: Doc<"runs">) => run.status === "completed" && (run.result?.status === "success" || run.result?.status === "needs_human_review");

export async function recipeCatalog(
  ctx: Pick<QueryCtx, "db">,
  instanceId: string,
  window: { from: number; to: number },
  options: { scanLimit?: number } = {},
): Promise<RecipeCatalog> {
  const scanLimit = options.scanLimit ?? SCAN_LIMIT;
  const inPeriod = (at: number) => at >= window.from && at <= window.to;

  // One more than the limit: it tells whether the Project has more recipes than are listed.
  const rows = await ctx.db.query("productionRecipes").withIndex("by_instance_target", (q) => q.eq("instanceId", instanceId)).take(MAX_RECIPES + 1);
  const recipesCut = rows.length > MAX_RECIPES;
  const recipes = rows.slice(0, MAX_RECIPES);
  const usage = new Map<Id<"productionRecipes">, Usage>(recipes.map((r) => [r._id, { lifetime: empty(), period: empty() }]));
  const bump = (recipeId: Id<"productionRecipes">, step: keyof Counts, at: number, last?: "lastMissionAt" | "lastAttemptAt" | "lastPublicationAt") => {
    const u = usage.get(recipeId);
    if (!u) return;
    u.lifetime[step] += 1;
    if (inPeriod(at)) u.period[step] += 1;
    if (last && at > (u[last] ?? 0)) u[last] = at;
  };

  // Missions: the Project's, per status (newest updated first), bounded.
  let missionsScanLimited = false;
  // A Mission with more Runs than we read: its attempt counters are incomplete.
  let runsCut = false;
  for (const status of MISSION_STATUSES) {
    const missions = await ctx.db.query("missions").withIndex("by_instance_status_updated", (q) => q.eq("instanceId", instanceId).eq("status", status)).order("desc").take(scanLimit);
    if (missions.length >= scanLimit) missionsScanLimited = true;
    for (const mission of missions) {
      const recipeId = mission.recipeSnapshot?.recipeId;
      if (!recipeId || !usage.has(recipeId)) continue;
      bump(recipeId, "missions", mission.createdAt, "lastMissionAt");
      const runs = await ctx.db.query("runs").withIndex("by_mission", (q) => q.eq("missionId", mission._id)).take(RUNS_PER_MISSION);
      if (runs.length >= RUNS_PER_MISSION) runsCut = true;
      for (const run of runs) {
        if (!isAttempt(run)) continue;
        bump(recipeId, "productionAttempts", run.dispatchedAt!, "lastAttemptAt");
        if (isSuccessful(run)) bump(recipeId, "successfulAttempts", run.dispatchedAt!);
      }
    }
  }

  // Publications: those that reached `published`, attributed through their Mission's Recipe Snapshot.
  const { inWindow, installed, scanLimited, oldestScannedCreatedAt } = await publicationsInWindow(ctx, instanceId, { from: -Infinity, to: Infinity }, scanLimit);
  // A shared page is measured once, for the one recipe that owns it (ADR-084): never twice, never for an ambiguous one.
  const claims = measurementClaims(inWindow, installed, ({ mission }) => mission.recipeSnapshot?.recipeId);
  for (const { publication, mission, series, publishedAt, found } of inWindow) {
    const recipeId = mission.recipeSnapshot?.recipeId;
    if (!recipeId || !usage.has(recipeId)) continue;
    bump(recipeId, "publications", publishedAt, "lastPublicationAt");
    const links = found ? linkedAdapters(installed, found.publisher.adapter, found.channel.analyticsAdapter) : [];
    if (links.length === 0) continue;
    const snapshots = await ctx.db.query("performanceSnapshots").withIndex("by_publication", (q) => q.eq("publicationId", publication._id)).collect();
    // Measured: at least one declared metric was read, by any linked adapter.
    const measured = links.some(({ adapter }) => {
      if (claimStatus(claims, adapter, publication) !== "own") return false;
      const own = snapshots.filter((s) => (s.adapter ?? links[0].adapter.id) === adapter.id && s.postSeries === series).sort((a, b) => b.takenAt - a.takenAt)[0];
      return own !== undefined && adapter.metrics.some((m) => !m.derive && typeof (own.metrics as Record<string, unknown>)[m.key] === "number");
    });
    if (measured) bump(recipeId, "measuredPublications", publishedAt);
  }

  const entries = recipes
    .map((recipe) => {
      const u = usage.get(recipe._id)!;
      const used = u.lifetime.missions > 0 || u.lifetime.productionAttempts > 0;
      const published = u.lifetime.publications > 0;
      // A flag is `true` only on a complete read: a cut recipe list or Run read may hide usage.
      const neverUsedEver = used ? false : missionsScanLimited || runsCut || recipesCut ? undefined : true;
      const neverPublishedEver = published ? false : scanLimited || recipesCut ? undefined : true;
      return {
        recipeId: recipe._id as string,
        name: recipe.name,
        description: recipe.description,
        missionType: recipe.missionType,
        templateId: recipe.templateId,
        ...originOf(recipe),
        usage: u,
        ...(neverUsedEver !== undefined ? { neverUsedEver } : {}),
        ...(neverPublishedEver !== undefined ? { neverPublishedEver } : {}),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.recipeId.localeCompare(b.recipeId));
  return {
    from: window.from,
    to: window.to,
    recipes: entries.slice(0, MAX_RECIPES),
    total: entries.length,
    truncated: entries.length > MAX_RECIPES || recipesCut,
    missionsScanLimited,
    publicationsScanLimited: scanLimited,
    ...(oldestScannedCreatedAt !== undefined ? { oldestScannedCreatedAt } : {}),
    partial: missionsScanLimited || scanLimited || runsCut || recipesCut,
  };
}
