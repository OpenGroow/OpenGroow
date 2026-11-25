import { SOURCE_PROVIDER } from "@opengroow/agent-templates";
import { isIsoDate, utcDateOf } from "@opengroow/protocol/content-planning-pins";
import type { Doc, Id } from "./_generated/dataModel.js";
import type { QueryCtx } from "./_generated/server.js";
import { getTemplateRegistry } from "./template_registry.js";

// The Internal MCP's read tools for Content Planning (ADR-086, issue #178). Read-only,
// scoped to one Project, bounded in page size and date range.

export type MissionTypeFormat = {
  /** The format (`publish.kind`); null when the Mission type publishes nothing (it cannot be planned). */
  kind: string | null;
  platforms: string[];
  /** The Mission type declares the `observation-production-source` context provider. */
  sourceRequired: boolean;
};

type ManifestMissionType = { type: string; publish?: { kind?: string; platforms?: string[] }; contextProviders?: string[] };

/** `inheritedProviders`: the Template-level context providers, which apply to a Mission type that declares none of its own. */
export function formatOf(missionType: ManifestMissionType | undefined, inheritedProviders?: readonly string[]): MissionTypeFormat {
  return {
    kind: missionType?.publish?.kind ?? null,
    platforms: missionType?.publish?.platforms ?? [],
    sourceRequired: (missionType?.contextProviders ?? inheritedProviders)?.includes(SOURCE_PROVIDER) ?? false,
  };
}

/** The format of the Mission types of a Project's Templates, resolved once per Template; unknown ones are null. */
export function missionTypeFormats(ctx: Pick<QueryCtx, "db">, instanceId: string) {
  const registry = getTemplateRegistry(ctx as QueryCtx);
  const cache = new Map<string, Promise<ManifestMissionType[]>>();
  return async (templateId: string, missionType: string): Promise<MissionTypeFormat> => {
    let types = cache.get(templateId);
    if (!types) {
      types = registry.resolve(instanceId, templateId).then((t) => (t?.manifest.missionTypes ?? []) as ManifestMissionType[]);
      cache.set(templateId, types);
    }
    return formatOf((await types).find((m) => m.type === missionType));
  };
}

// ─── Sources ───────────────────────────────────────────────────────────────

const SOURCES_DEFAULT_LIMIT = 20;
const SOURCES_MAX_LIMIT = 50;
/** Sources read before ordering; newest first. */
const SOURCES_SCAN_LIMIT = 300;
const SOURCE_STATUSES = ["processing", "ready", "failed", "unavailable"] as const;

export function boundedLimit(value: unknown, fallback: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.min(Math.floor(value), max) : fallback;
}

const isProduced = (s: Doc<"sources">) => s.producedAt !== undefined || s.productionMissionId !== undefined;
const isSelected = (s: Doc<"sources">) => s.selectedAt !== undefined;

export async function listSources(ctx: Pick<QueryCtx, "db">, instanceId: string, args: { status?: unknown; produced?: unknown; limit?: unknown }) {
  const status = args.status === undefined ? "ready" : args.status;
  if (!SOURCE_STATUSES.includes(status as never)) throw new Error(`status must be one of ${SOURCE_STATUSES.join(", ")}.`);
  if (args.produced !== undefined && typeof args.produced !== "boolean") throw new Error("produced must be true or false.");
  const limit = boundedLimit(args.limit, SOURCES_DEFAULT_LIMIT, SOURCES_MAX_LIMIT);

  const rows = await ctx.db
    .query("sources")
    .withIndex("by_instance_status_capturedAt", (q) => q.eq("instanceId", instanceId).eq("status", status as (typeof SOURCE_STATUSES)[number]))
    .order("desc")
    .take(SOURCES_SCAN_LIMIT);
  const scanLimited = rows.length >= SOURCES_SCAN_LIMIT;
  const kept = rows.filter((s) => s.excluded !== true && (args.produced === undefined || isProduced(s) === args.produced));
  const score = (s: Doc<"sources">) => s.scoring?.replicationScore ?? -1;
  // Neither selected nor produced first, then the best Replication Score, then the newest.
  kept.sort((a, b) => Number(isSelected(a) || isProduced(a)) - Number(isSelected(b) || isProduced(b)) || score(b) - score(a) || b.capturedAt - a.capturedAt);
  const page = kept.slice(0, limit);

  const families = new Map<Id<"creativeFamilies">, Doc<"creativeFamilies"> | null>();
  const sources = [];
  for (const s of page) {
    let creativeFamily: { id: string; name: string } | undefined;
    if (s.creativeFamilyId) {
      if (!families.has(s.creativeFamilyId)) families.set(s.creativeFamilyId, await ctx.db.get(s.creativeFamilyId));
      const f = families.get(s.creativeFamilyId);
      if (f && f.instanceId === instanceId) creativeFamily = { id: f._id, name: f.name };
    }
    const { replicationScore, ...subScores } = s.scoring ?? {};
    sources.push({
      sourceId: s._id as string,
      label: s.label,
      origin: s.origin,
      status: s.status,
      capturedAt: s.capturedAt,
      ...(replicationScore !== undefined ? { replicationScore } : {}),
      ...(Object.keys(subScores).length ? { scores: subScores } : {}),
      ...(s.marketing?.summary ? { summary: s.marketing.summary } : {}),
      ...(creativeFamily ? { creativeFamily } : {}),
      selected: isSelected(s),
      produced: isProduced(s),
    });
  }
  return { sources, total: kept.length, truncated: kept.length > page.length, scanLimited };
}

// ─── Planned Contents ──────────────────────────────────────────────────────

const PLANNED_DEFAULT_LIMIT = 50;
const PLANNED_MAX_LIMIT = 200;
const MAX_RANGE_DAYS = 92;
const PLANNED_STATUSES = ["proposed", "approved", "rejected"] as const;
const DAY_MS = 24 * 3_600_000;

function parseDate(value: unknown, name: string): number {
  if (typeof value !== "string" || !isIsoDate(value)) throw new Error(`${name} must be a date as YYYY-MM-DD.`);
  return Date.parse(`${value}T00:00:00Z`);
}

export async function listPlannedContents(ctx: Pick<QueryCtx, "db">, instanceId: string, args: { from?: unknown; to?: unknown; status?: unknown; limit?: unknown }) {
  if ((args.from === undefined) !== (args.to === undefined)) throw new Error("Give both from and to (YYYY-MM-DD), or neither.");
  const fromMs = args.from === undefined ? Math.floor(Date.now() / DAY_MS) * DAY_MS : parseDate(args.from, "from");
  const toMs = args.to === undefined ? fromMs + 30 * DAY_MS : parseDate(args.to, "to");
  if (toMs < fromMs) throw new Error("from must be before or equal to to.");
  if ((toMs - fromMs) / DAY_MS + 1 > MAX_RANGE_DAYS) throw new Error(`The date range spans at most ${MAX_RANGE_DAYS} days.`);
  if (args.status !== undefined && !PLANNED_STATUSES.includes(args.status as never)) throw new Error(`status must be one of ${PLANNED_STATUSES.join(", ")}.`);
  const limit = boundedLimit(args.limit, PLANNED_DEFAULT_LIMIT, PLANNED_MAX_LIMIT);
  const from = utcDateOf(fromMs);
  const to = utcDateOf(toMs);

  const statuses = args.status ? [args.status as (typeof PLANNED_STATUSES)[number]] : PLANNED_STATUSES;
  const perStatus = await Promise.all(
    statuses.map((status) =>
      ctx.db
        .query("plannedContents")
        .withIndex("by_instance_status_plannedAt", (q) => q.eq("instanceId", instanceId).eq("status", status).gte("plannedAt", from).lte("plannedAt", to))
        .take(limit + 1),
    ),
  );
  const all = perStatus.flat().sort((a, b) => a.plannedAt.localeCompare(b.plannedAt) || a._creationTime - b._creationTime);
  const page = all.slice(0, limit);
  return {
    from,
    to,
    plannedContents: page.map((p) => ({
      plannedContentId: p._id as string,
      planId: p.planId as string,
      kind: p.kind,
      missionType: p.missionType,
      recipeId: p.recipeId as string,
      ...(p.sourceId ? { sourceId: p.sourceId as string } : {}),
      publishTargets: p.publishTargets,
      title: p.title,
      brief: p.brief,
      plannedAt: p.plannedAt,
      intent: p.intent,
      rationale: p.rationale,
      status: p.status,
      createdAt: p.createdAt,
    })),
    truncated: all.length > page.length,
  };
}
