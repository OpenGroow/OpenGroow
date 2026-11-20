import type { InternalMcpToolName } from "@opengroow/agent-templates";
import { DEFAULT_WINDOW_DAYS, listPublicationReadings, summarizeProject } from "../analytics_summary.js";
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

const DAY_MS = 24 * 60 * 60_000;
const MISSIONS_DEFAULT_LIMIT = 20;
const MISSIONS_MAX_LIMIT = 50;
const PLAN_HISTORY_DEFAULT_LIMIT = 10;
const PLAN_HISTORY_MAX_LIMIT = 30;
/** Missions read per status before keeping the Plans: the Plan Missions are few next to the others. */
const PLAN_HISTORY_SCAN = 100;
const PUBLICATIONS_DEFAULT_LIMIT = 50;
const PUBLICATIONS_MAX_LIMIT = 200;
const MISSION_STATUSES = ["todo", "doing", "blocked", "to_validate", "approved", "done", "failed", "cancelled"] as const;

/** A positive whole number from the arguments, within `max`, else the default. */
function boundedInt(value: unknown, fallback: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.min(Math.floor(value), max) : fallback;
}

function windowOf(args: Record<string, unknown>) {
  const to = Date.now();
  return { from: to - boundedInt(args.days, DEFAULT_WINDOW_DAYS, 365) * DAY_MS, to };
}

const DAYS_PROPERTY = { type: "integer", minimum: 1, maximum: 365, description: `Look-back window in days, by publication date (default ${DEFAULT_WINDOW_DAYS}).` } as const;

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

/**
 * The Project's previous Plan Missions (those carrying a Plan in `lastResult.plan`), newest first: the items
 * proposed, the items the user declined on approval, and the feedback the user gave each time a Plan was
 * rejected (the `humanFeedback` of the Mission's revision Runs, oldest first). So the Strategy Agent does not
 * propose again what was refused.
 */
async function listPlanHistory(ctx: QueryCtx, scope: InternalMcpScope, limit: number) {
  const byStatus = await Promise.all(
    MISSION_STATUSES.map((status) =>
      ctx.db
        .query("missions")
        .withIndex("by_instance_status_updated", (q) => q.eq("instanceId", scope.instanceId).eq("status", status))
        .order("desc")
        .take(PLAN_HISTORY_SCAN),
    ),
  );
  const plans = byStatus
    .flat()
    .filter((mission) => Array.isArray((mission.lastResult as { plan?: unknown } | undefined)?.plan))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
  return Promise.all(
    plans.map(async (mission) => {
      const runs = await ctx.db.query("runs").withIndex("by_mission", (q) => q.eq("missionId", mission._id)).take(50);
      const feedback = runs
        .filter((run) => run.humanFeedback !== undefined)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((run) => run.humanFeedback);
      return {
        missionId: mission._id,
        ...(mission.number !== undefined ? { number: mission.number } : {}),
        ...(mission.name ? { name: mission.name } : {}),
        status: mission.status,
        createdAt: mission.createdAt,
        updatedAt: mission.updatedAt,
        items: (mission.lastResult as { plan: unknown[] }).plan,
        declinedItems: mission.declinedPlanItems ?? [],
        feedback,
      };
    }),
  );
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
      "How the Project's Publications performed, aggregated by Analytics Adapter, platform, format and Mission type: counters summed, derived levels recomputed from the sums, plus the direction (better: higher or lower) of each metric. A group with status no_data is linked to analytics but not read yet; `unavailable` lists Publications whose channel has no Analytics Adapter, which is not the same as no data.",
    inputSchema: { type: "object", properties: { days: DAYS_PROPERTY }, additionalProperties: false },
    run: (ctx, scope, args) => summarizeProject(ctx, scope.instanceId, windowOf(args)),
  },
  list_publications: {
    description:
      "The Project's published Publications, newest first, each with its platform, format, Mission, link and latest measurements per Analytics Adapter. status is data (measured), no_data (linked, nothing read yet) or unavailable (the channel has no Analytics Adapter).",
    inputSchema: {
      type: "object",
      properties: { days: DAYS_PROPERTY, limit: { type: "integer", minimum: 1, maximum: PUBLICATIONS_MAX_LIMIT, description: `At most this many (default ${PUBLICATIONS_DEFAULT_LIMIT}).` } },
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
  list_plan_history: {
    description:
      "The Project's previous Plans, newest first: the items each proposed (type, Template, payload, reason, figures), the items the user declined when approving, and the feedback the user gave when rejecting it. Read it before planning so you do not propose again what was declined or rejected.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: PLAN_HISTORY_MAX_LIMIT, description: `At most this many Plans (default ${PLAN_HISTORY_DEFAULT_LIMIT}).` } },
      additionalProperties: false,
    },
    run: (ctx, scope, args) => listPlanHistory(ctx, scope, boundedInt(args.limit, PLAN_HISTORY_DEFAULT_LIMIT, PLAN_HISTORY_MAX_LIMIT)),
  },
  get_brand_core: {
    description: "The Project's Brand Core: audience, tone, offer, positioning, editorial rules, constraints, what to avoid and notes. Null when none is written yet.",
    inputSchema: NO_ARGUMENTS,
    run: (ctx, scope) => getBrandCore(ctx, scope),
  },
};

export function catalogTool(name: string): InternalMcpTool | undefined {
  return Object.prototype.hasOwnProperty.call(INTERNAL_MCP_CATALOG, name) ? INTERNAL_MCP_CATALOG[name as InternalMcpToolName] : undefined;
}
