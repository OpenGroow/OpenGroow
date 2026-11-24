import type { QueryCtx } from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { linkedAdapters } from "./analytics_adapters.js";
import { publicationsInWindow, SCAN_LIMIT } from "./analytics_summary.js";

// The Production Recipe catalog with its usage history (ADR-084, issue #158), read through the
// Internal MCP. Computed on read from Missions, Runs and Publications; nothing is stored. Marketing
// performance stays on the Analytics page, usage stays here.

const MAX_FAMILIES = 200;
const MAX_RECIPES_PER_FAMILY = 100;
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
    archived: boolean;
    creativeFamily: { id: string; name: string; archived: boolean };
    usage: Usage;
    /** Absent (unknown) when the Missions read was incomplete and none was seen. */
    neverUsedEver?: boolean;
    /** Absent (unknown) when the Publications read was incomplete and none was seen. */
    neverPublishedEver?: boolean;
  }>;
  total: number;
  /** The list was cut at its size limit. */
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

  const families = await ctx.db.query("creativeFamilies").withIndex("by_instance", (q) => q.eq("instanceId", instanceId)).take(MAX_FAMILIES);
  const recipes: Doc<"productionRecipes">[] = [];
  let recipesCut = families.length >= MAX_FAMILIES;
  for (const family of families) {
    const rows = await ctx.db.query("productionRecipes").withIndex("by_instance_family", (q) => q.eq("instanceId", instanceId).eq("creativeFamilyId", family._id)).take(MAX_RECIPES_PER_FAMILY);
    if (rows.length >= MAX_RECIPES_PER_FAMILY) recipesCut = true;
    recipes.push(...rows);
  }
  const familyOf = new Map(families.map((f) => [f._id, f]));
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
  for (const status of MISSION_STATUSES) {
    const missions = await ctx.db.query("missions").withIndex("by_instance_status_updated", (q) => q.eq("instanceId", instanceId).eq("status", status)).order("desc").take(scanLimit);
    if (missions.length >= scanLimit) missionsScanLimited = true;
    for (const mission of missions) {
      const recipeId = mission.recipeSnapshot?.recipeId;
      if (!recipeId || !usage.has(recipeId)) continue;
      bump(recipeId, "missions", mission.createdAt, "lastMissionAt");
      const runs = await ctx.db.query("runs").withIndex("by_mission", (q) => q.eq("missionId", mission._id)).take(RUNS_PER_MISSION);
      for (const run of runs) {
        if (!isAttempt(run)) continue;
        bump(recipeId, "productionAttempts", run.dispatchedAt!, "lastAttemptAt");
        if (isSuccessful(run)) bump(recipeId, "successfulAttempts", run.dispatchedAt!);
      }
    }
  }

  // Publications: those that reached `published`, attributed through their Mission's Recipe Snapshot.
  const { inWindow, installed, scanLimited, oldestScannedCreatedAt } = await publicationsInWindow(ctx, instanceId, { from: -Infinity, to: Infinity }, scanLimit);
  for (const { publication, mission, series, publishedAt, found } of inWindow) {
    const recipeId = mission.recipeSnapshot?.recipeId;
    if (!recipeId || !usage.has(recipeId)) continue;
    bump(recipeId, "publications", publishedAt, "lastPublicationAt");
    const links = found ? linkedAdapters(installed, found.publisher.adapter, found.channel.analyticsAdapter) : [];
    if (links.length === 0) continue;
    const snapshots = await ctx.db.query("performanceSnapshots").withIndex("by_publication", (q) => q.eq("publicationId", publication._id)).collect();
    // Measured: at least one declared metric was read, by any linked adapter.
    const measured = links.some(({ adapter }) => {
      const own = snapshots.filter((s) => (s.adapter ?? links[0].adapter.id) === adapter.id && s.postSeries === series).sort((a, b) => b.takenAt - a.takenAt)[0];
      return own !== undefined && adapter.metrics.some((m) => !m.derive && typeof (own.metrics as Record<string, unknown>)[m.key] === "number");
    });
    if (measured) bump(recipeId, "measuredPublications", publishedAt);
  }

  const entries = recipes
    .map((recipe) => {
      const family = familyOf.get(recipe.creativeFamilyId)!;
      const u = usage.get(recipe._id)!;
      const used = u.lifetime.missions > 0 || u.lifetime.productionAttempts > 0;
      const published = u.lifetime.publications > 0;
      const neverUsedEver = used ? false : missionsScanLimited ? undefined : true;
      const neverPublishedEver = published ? false : scanLimited ? undefined : true;
      return {
        recipeId: recipe._id as string,
        name: recipe.name,
        description: recipe.description,
        missionType: recipe.missionType,
        templateId: recipe.templateId,
        archived: recipe.status === "archived",
        creativeFamily: { id: family._id as string, name: family.name, archived: family.status === "archived" },
        usage: u,
        ...(neverUsedEver !== undefined ? { neverUsedEver } : {}),
        ...(neverPublishedEver !== undefined ? { neverPublishedEver } : {}),
      };
    })
    .sort((a, b) => a.creativeFamily.name.localeCompare(b.creativeFamily.name) || a.name.localeCompare(b.name) || a.recipeId.localeCompare(b.recipeId));
  return {
    from: window.from,
    to: window.to,
    recipes: entries.slice(0, MAX_RECIPES),
    total: entries.length,
    truncated: entries.length > MAX_RECIPES || recipesCut,
    missionsScanLimited,
    publicationsScanLimited: scanLimited,
    ...(oldestScannedCreatedAt !== undefined ? { oldestScannedCreatedAt } : {}),
    partial: missionsScanLimited || scanLimited,
  };
}
