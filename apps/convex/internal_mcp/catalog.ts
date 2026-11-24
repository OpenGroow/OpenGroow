import type { InternalMcpToolName } from "@opengroow/agent-templates";
import { DEFAULT_WINDOW_DAYS, MAX_WINDOW_DAYS, listPublicationReadings, resolveWindow, summarizeProject } from "../analytics_summary.js";
import { summarizeByRecipe } from "../analytics_recipe.js";
import { summarizeByFamily } from "../analytics_family.js";
import { recipeCatalog } from "../recipe_usage.js";
import { getTemplateRegistry } from "../template_registry.js";
import type { QueryCtx } from "../_generated/server.js";

/**
 * The Internal MCP's tool catalog (ADR-080). One server, many tools: a Template
 * declares the names it may call, and the endpoint serves only those.
 *
 * To add a tool:
 *  1. add its name to `INTERNAL_MCP_TOOL_NAMES` in packages/agent-templates/src/internal-mcp.ts
 *     (Templates may declare it from then on, and the catalog type below then demands its definition);
 *  2. add its entry in `INTERNAL_MCP_CATALOG` here: description, input schema, and a `run`
 *     that reads through `ctx` and is scoped to `scope.instanceId` (the Agent's Project).
 * Tools are read-only: the endpoint always lists them with `readOnlyHint: true`, so the runtime does
 * not ask approval on each call. A tool never takes the Project from its arguments: the scope comes
 * from the authenticated token.
 */
export type InternalMcpScope = { instanceId: string; templateId: string };

export type InternalMcpTool = {
  description: string;
  /** JSON Schema of the arguments (an object schema). */
  inputSchema: Record<string, unknown>;
  run(ctx: QueryCtx, scope: InternalMcpScope, args: Record<string, unknown>): Promise<unknown>;
};

const NO_ARGUMENTS = { type: "object", properties: {}, additionalProperties: false } as const;

async function listMissionTypes(ctx: QueryCtx, scope: InternalMcpScope) {
  const agents = await ctx.db
    .query("projectAgents")
    .withIndex("by_instance_status", (q) => q.eq("instanceId", scope.instanceId).eq("status", "active"))
    .take(100);
  const registry = getTemplateRegistry(ctx);
  const types: { templateId: string; templateName: string; type: string; label: string; description: string }[] = [];
  for (const agent of agents) {
    const template = await registry.resolve(scope.instanceId, agent.templateId);
    if (!template) continue;
    const hidden = new Set(agent.hiddenMissionTypes ?? []);
    for (const missionType of template.manifest.missionTypes ?? []) {
      if (hidden.has(missionType.type)) continue;
      types.push({
        templateId: agent.templateId,
        templateName: template.manifest.name,
        type: missionType.type,
        label: missionType.label,
        description: missionType.description ?? template.manifest.description,
      });
    }
  }
  return types.sort((a, b) => a.templateId.localeCompare(b.templateId) || a.type.localeCompare(b.type));
}

const MISSIONS_DEFAULT_LIMIT = 20;
const MISSIONS_MAX_LIMIT = 50;
const PUBLICATIONS_DEFAULT_LIMIT = 50;
const PUBLICATIONS_MAX_LIMIT = 200;
const MISSION_STATUSES = ["todo", "doing", "blocked", "to_validate", "approved", "done", "failed", "cancelled"] as const;

/** A positive whole number from the arguments, within `max`, else the default. */
function boundedInt(value: unknown, fallback: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.min(Math.floor(value), max) : fallback;
}

const numberArg = (value: unknown) => (value === undefined || value === null ? undefined : (value as number));

/** The period of a call: `days`, or `from` and `to` (never both); a bad one is an error the Agent can read. */
function windowOf(args: Record<string, unknown>) {
  return resolveWindow({ days: numberArg(args.days), from: numberArg(args.from), to: numberArg(args.to) });
}

const DAYS_PROPERTY = { type: "integer", minimum: 1, maximum: MAX_WINDOW_DAYS, description: `Look-back window in days, by publication date (default ${DEFAULT_WINDOW_DAYS}). Not with from/to.` } as const;
const RANGE_PROPERTIES = {
  from: { type: "integer", description: `Start of a custom period (ms timestamp), by publication date. Needs to; at most ${MAX_WINDOW_DAYS} days before it. Not with days.` },
  to: { type: "integer", description: "End of a custom period (ms timestamp). Needs from." },
} as const;
const PLATFORM_PROPERTY = { type: "string", description: "Only this platform (for instance instagram)." } as const;

/** The Project's most recently updated Missions, newest first, with their status and outcome. */
async function listRecentMissions(ctx: QueryCtx, scope: InternalMcpScope, limit: number) {
  const byStatus = await Promise.all(
    MISSION_STATUSES.map((status) =>
      ctx.db
        .query("missions")
        .withIndex("by_instance_status_updated", (q) => q.eq("instanceId", scope.instanceId).eq("status", status))
        .order("desc")
        .take(limit),
    ),
  );
  return byStatus
    .flat()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
    .map((mission) => {
      const summary = mission.lastResult?.summary ?? mission.summary;
      return {
        missionId: mission._id,
        ...(mission.number !== undefined ? { number: mission.number } : {}),
        ...(mission.name ? { name: mission.name } : {}),
        type: mission.type,
        templateId: mission.templateId,
        status: mission.status,
        createdAt: mission.createdAt,
        updatedAt: mission.updatedAt,
        outcome: { ...(summary ? { summary } : {}), ...(mission.errorMessage ? { error: mission.errorMessage } : {}) },
      };
    });
}

async function getBrandCore(ctx: QueryCtx, scope: InternalMcpScope) {
  const row = await ctx.db
    .query("brandCores")
    .withIndex("by_instance", (q) => q.eq("instanceId", scope.instanceId))
    .unique();
  if (!row) return null;
  const { _id, _creationTime, instanceId, ...rubrics } = row;
  return rubrics;
}

export const INTERNAL_MCP_CATALOG: Record<InternalMcpToolName, InternalMcpTool> = {
  list_mission_types: {
    description:
      "List the Mission types this Project can activate right now: the Mission types of its active Agents, minus the ones the operator hid. Each entry has the Template id, the Mission type, its label and a description of what it produces.",
    inputSchema: NO_ARGUMENTS,
    run: (ctx, scope) => listMissionTypes(ctx, scope),
  },
  get_analytics_summary: {
    description:
      "How the Project's Publications performed, aggregated by Analytics Adapter, platform, format and Mission type: counters summed, derived levels recomputed from the sums, plus the direction (better: higher or lower) of each metric. With groupBy recipe the figures are grouped by Production Recipe (read through the Mission's Recipe Snapshot): per recipe, its versions, last publication date, Publication age, then per adapter and platform each metric's observations, sum (counters), mean and median, and for a ratio the value recomputed from the sums and the mean and median of per-Publication ratios; a missing metric is absent, never zero, and unattributed Publications are counted apart. recipeId narrows to one recipe. With groupBy family the figures are grouped by Creative Family, computed over the union of the family's Publications (never from its recipes' averages), with each recipe's own result listed inside its family under `recipes`; an archived or merged family stays under its own identity with `archived` and `mergedIntoId`. familyId narrows to one family. A group with status no_data is linked to analytics but not read yet; `unavailable` lists Publications whose channel has no Analytics Adapter, which is not the same as no data.",
    inputSchema: { type: "object", properties: {
        days: DAYS_PROPERTY,
        ...RANGE_PROPERTIES,
        platform: PLATFORM_PROPERTY,
        groupBy: { type: "string", enum: ["recipe", "family"], description: "Group by Production Recipe or Creative Family instead of platform, format and Mission type." },
        recipeId: { type: "string", description: 'Only this Production Recipe (needs groupBy "recipe").' },
        familyId: { type: "string", description: 'Only this Creative Family (needs groupBy "family").' },
      },
      additionalProperties: false,
    },
    run: (ctx, scope, args) => {
      const platform = typeof args.platform === "string" ? args.platform : undefined;
      if (args.groupBy === "recipe" && args.familyId !== undefined) throw new Error('familyId needs groupBy "family".');
      if (args.groupBy === "family" && args.recipeId !== undefined) throw new Error('recipeId needs groupBy "recipe".');
      if (args.groupBy === "recipe") return summarizeByRecipe(ctx, scope.instanceId, windowOf(args), { platform, recipeId: typeof args.recipeId === "string" ? args.recipeId : undefined });
      if (args.groupBy === "family") return summarizeByFamily(ctx, scope.instanceId, windowOf(args), { platform, familyId: typeof args.familyId === "string" ? args.familyId : undefined });
      if (args.groupBy !== undefined) throw new Error('groupBy must be "recipe" or "family".');
      if (args.recipeId !== undefined) throw new Error('recipeId needs groupBy "recipe".');
      if (args.familyId !== undefined) throw new Error('familyId needs groupBy "family".');
      return summarizeProject(ctx, scope.instanceId, windowOf(args), { platform });
    },
  },
  list_publications: {
    description:
      "The Project's published Publications, newest first, each with its platform, format, Mission, link and latest measurements per Analytics Adapter. status is data (measured), no_data (linked, nothing read yet) or unavailable (the channel has no Analytics Adapter).",
    inputSchema: {
      type: "object",
      properties: { days: DAYS_PROPERTY, ...RANGE_PROPERTIES, limit: { type: "integer", minimum: 1, maximum: PUBLICATIONS_MAX_LIMIT, description: `At most this many (default ${PUBLICATIONS_DEFAULT_LIMIT}).` } },
      additionalProperties: false,
    },
    run: (ctx, scope, args) => listPublicationReadings(ctx, scope.instanceId, windowOf(args), boundedInt(args.limit, PUBLICATIONS_DEFAULT_LIMIT, PUBLICATIONS_MAX_LIMIT)),
  },
  list_recent_missions: {
    description: "The Project's most recent Missions, newest first, with their type, status and outcome (the Run's summary, and the error when it failed).",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: MISSIONS_MAX_LIMIT, description: `At most this many (default ${MISSIONS_DEFAULT_LIMIT}).` } },
      additionalProperties: false,
    },
    run: (ctx, scope, args) => listRecentMissions(ctx, scope, boundedInt(args.limit, MISSIONS_DEFAULT_LIMIT, MISSIONS_MAX_LIMIT)),
  },
  get_brand_core: {
    description: "The Project's Brand Core: audience, tone, offer, positioning, editorial rules, constraints, what to avoid and notes. Null when none is written yet.",
    inputSchema: NO_ARGUMENTS,
    run: (ctx, scope) => getBrandCore(ctx, scope),
  },
  list_production_recipes: {
    description:
      "The Project's Production Recipes with their Creative Family, an archived flag and their usage, step by step: Missions created with the recipe (even cancelled before any Run), Production Attempts (Runs sent to the Agent) and successful ones, Publications and measured Publications, each over the recipe's lifetime and over the period (by its own date), with the last Mission, attempt and publication dates. Includes recipes that never produced a Publication. neverUsedEver and neverPublishedEver are present only when the data read was complete; otherwise they are absent (unknown). `partial` says a read hit its limit, `truncated` that the list was cut.",
    inputSchema: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 365, description: `Period in days for the period counters (default ${DEFAULT_WINDOW_DAYS}).` } }, additionalProperties: false },
    run: (ctx, scope, args) => recipeCatalog(ctx, scope.instanceId, windowOf(args)),
  },
};

export function catalogTool(name: string): InternalMcpTool | undefined {
  return Object.prototype.hasOwnProperty.call(INTERNAL_MCP_CATALOG, name) ? INTERNAL_MCP_CATALOG[name as InternalMcpToolName] : undefined;
}
