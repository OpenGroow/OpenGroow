import type { Doc, Id } from "./_generated/dataModel.js";
import type { QueryCtx } from "./_generated/server.js";
import { boundedLimit } from "./planning_reads.js";
import { latestVersion } from "./production_recipes.js";

// The Internal MCP's reads for a Recipe Generation (ADR-087, ticket #190). Read-only. The
// pinned Creative Family comes from the Agent's running Standalone Run, never from arguments.

type Scope = { instanceId: string; templateId: string };

const FAMILY_SOURCES_DEFAULT_LIMIT = 10;
const FAMILY_SOURCES_MAX_LIMIT = 25;
/** Sources read before filtering and ordering; newest first. */
const FAMILY_SCAN_LIMIT = 500;

const NOT_RUNNING = "This tool is only available while a Recipe Generation is running for this Agent.";
const OUTSIDE_PIN = "That Source is not readable: it is not a ready, non-excluded Source of the pinned Creative Family.";

type Pin = { familyId: Id<"creativeFamilies">; ownerId: string };

/** The Agent's running Standalone Run (one at a time, ADR-087); throws when `required` and there is none. */
export async function pinnedGeneration(ctx: Pick<QueryCtx, "db">, scope: Scope, options: { required: true }): Promise<Pin>;
export async function pinnedGeneration(ctx: Pick<QueryCtx, "db">, scope: Scope, options: { required: false }): Promise<Pin | undefined>;
export async function pinnedGeneration(ctx: Pick<QueryCtx, "db">, scope: Scope, options: { required: boolean }): Promise<Pin | undefined> {
  const running = await ctx.db
    .query("runs")
    .withIndex("by_instance_template_status", (q) => q.eq("instanceId", scope.instanceId).eq("templateId", scope.templateId).eq("status", "running"))
    .take(20);
  for (const run of running) {
    if ("recipeGeneration" in run && run.recipeGeneration) return { familyId: run.recipeGeneration.familyId, ownerId: run.ownerId };
  }
  if (options.required) throw new Error(NOT_RUNNING);
  return undefined;
}

const isProduced = (s: Doc<"sources">) => s.producedAt !== undefined || s.productionMissionId !== undefined;
const isReadable = (s: Doc<"sources">) => s.status === "ready" && s.excluded !== true;
const scoreOf = (s: Doc<"sources">) => s.scoring?.replicationScore ?? -1;

/** The pinned family's readable Sources, newest first (bounded scan). */
async function readableFamilySources(ctx: Pick<QueryCtx, "db">, scope: Scope, pin: Pin) {
  const rows = await ctx.db
    .query("sources")
    .withIndex("by_instance_owner_creativeFamily_createdAt", (q) => q.eq("instanceId", scope.instanceId).eq("ownerId", pin.ownerId).eq("creativeFamilyId", pin.familyId))
    .order("desc")
    .take(FAMILY_SCAN_LIMIT);
  return { sources: rows.filter(isReadable), scanLimited: rows.length >= FAMILY_SCAN_LIMIT };
}

export async function getCreativeFamily(ctx: Pick<QueryCtx, "db">, scope: Scope) {
  const pin = await pinnedGeneration(ctx, scope, { required: true });
  const family = await ctx.db.get(pin.familyId);
  if (!family || family.instanceId !== scope.instanceId) throw new Error("The pinned Creative Family no longer exists.");
  const { sources, scanLimited } = await readableFamilySources(ctx, scope, pin);
  return { familyId: family._id as string, name: family.name, description: family.description, sourceCount: sources.length, ...(scanLimited ? { sourceCountIsLowerBound: true } : {}) };
}

export async function listFamilySources(ctx: Pick<QueryCtx, "db">, scope: Scope, args: Record<string, unknown>) {
  const pin = await pinnedGeneration(ctx, scope, { required: true });
  if (args.produced !== undefined && typeof args.produced !== "boolean") throw new Error("produced must be true or false.");
  if (args.minReplicationScore !== undefined && (typeof args.minReplicationScore !== "number" || !Number.isFinite(args.minReplicationScore))) throw new Error("minReplicationScore must be a number.");
  if (args.sort !== undefined && args.sort !== "recent" && args.sort !== "score") throw new Error('sort must be "recent" or "score".');
  const limit = boundedLimit(args.limit, FAMILY_SOURCES_DEFAULT_LIMIT, FAMILY_SOURCES_MAX_LIMIT);
  const offset = args.cursor === undefined ? 0 : Number(args.cursor);
  if (!Number.isInteger(offset) || offset < 0) throw new Error("cursor is not valid: pass the nextCursor of a previous page.");

  const { sources, scanLimited } = await readableFamilySources(ctx, scope, pin);
  const kept = sources.filter(
    (s) => (args.produced === undefined || isProduced(s) === args.produced) && (args.minReplicationScore === undefined || scoreOf(s) >= (args.minReplicationScore as number)),
  );
  if (args.sort === "score") kept.sort((a, b) => scoreOf(b) - scoreOf(a) || b.capturedAt - a.capturedAt);
  else kept.sort((a, b) => b.capturedAt - a.capturedAt);

  const page = kept.slice(offset, offset + limit);
  const next = offset + page.length;
  return {
    sources: page.map((s) => {
      const { replicationScore, ...subScores } = s.scoring ?? {};
      return {
        sourceId: s._id as string,
        label: s.label,
        origin: s.origin,
        capturedAt: s.capturedAt,
        ...(replicationScore !== undefined ? { replicationScore } : {}),
        ...(Object.keys(subScores).length ? { scores: subScores } : {}),
        ...(s.marketing?.summary ? { summary: s.marketing.summary } : {}),
        produced: isProduced(s),
      };
    }),
    total: kept.length,
    ...(next < kept.length ? { nextCursor: String(next) } : {}),
    scanLimited,
  };
}

export async function getSource(ctx: Pick<QueryCtx, "db">, scope: Scope, args: Record<string, unknown>) {
  const pin = await pinnedGeneration(ctx, scope, { required: true });
  const id = typeof args.sourceId === "string" ? ctx.db.normalizeId("sources", args.sourceId) : null;
  const source = id ? await ctx.db.get(id) : null;
  if (!source || source.instanceId !== scope.instanceId || source.creativeFamilyId !== pin.familyId || !isReadable(source)) throw new Error(OUTSIDE_PIN);
  return {
    sourceId: source._id as string,
    label: source.label,
    origin: source.origin,
    status: source.status,
    capturedAt: source.capturedAt,
    analysis: source.analysis,
    scoring: source.scoring ?? {},
    marketing: source.marketing,
    produced: isProduced(source),
  };
}

export async function getProductionRecipe(ctx: QueryCtx, scope: Scope, args: Record<string, unknown>) {
  const id = typeof args.recipeId === "string" ? ctx.db.normalizeId("productionRecipes", args.recipeId) : null;
  const recipe = id ? await ctx.db.get(id) : null;
  if (!recipe || recipe.instanceId !== scope.instanceId) throw new Error("Production Recipe not found.");
  const family = await ctx.db.get(recipe.creativeFamilyId);
  const version = await latestVersion(ctx, recipe._id);
  return {
    recipeId: recipe._id as string,
    name: recipe.name,
    description: recipe.description,
    templateId: recipe.templateId,
    missionType: recipe.missionType,
    archived: recipe.status === "archived",
    creativeFamily: { id: recipe.creativeFamilyId as string, name: family?.name ?? "" },
    latestVersion: version ? { version: version.version, prompt: version.prompt, instructions: version.instructions, constraints: version.constraints, createdAt: version.createdAt } : null,
  };
}
