import type { Doc, Id } from "./_generated/dataModel.js";
import type { MutationCtx } from "./_generated/server.js";
import { publishDeclarationFor } from "@opengroow/agent-templates";
import { countByContentType } from "./content_plan_counts.js";
import { assertRecipeCompatible } from "./mission_recipe.js";
import { contentTypeOf } from "./planning_reads.js";
import { parseContentPlanEnvelope, type PlannedItem } from "./content_plan_rules.js";
import { capabilityOfTarget, channelOf, projectPublishers, type ProjectPublisher } from "./project_publishers.js";
import { getTemplateRegistry } from "./template_registry.js";

// Persistence of Content Plans (ADR-086, issue #176). One atomic mutation context: the result of a Content Planning
// Run is validated as a whole against the Project and the pins taken at dispatch, then written as one `draft` plan
// with its `proposed` Planned Contents, or not at all. Nothing else is written (no Mission, Publication, Recipe
// or Strategic Memory).

export type PersistPlanResult =
  | {
      ok: true;
      planId: Id<"contentPlans"> | null;
      created: boolean;
      count: number;
      uncertain: Array<{ index: number; target: string; reason: string }>;
      /** The Agent's rationale, given when the result plans nothing (no plan is stored to carry it). */
      rationale?: string;
    }
  | { ok: false; reason: "invalid_result"; message: string; errors: string[] }
  | { ok: false; reason: "draft_exists"; message: string };

const invalid = (errors: string[]): PersistPlanResult => ({ ok: false, reason: "invalid_result", message: errors.join(" "), errors });

/** Why a plan cannot be revalidated: its Run no longer carries the pins taken at dispatch. */
export const NO_PINS_MESSAGE = "The Run that produced this plan no longer carries its targets: reject the plan and plan again.";

/** The Run that produced a plan and the pins it carries, or null when the Run is gone or no longer carries them. */
export async function pinsOf(ctx: MutationCtx, plan: Doc<"contentPlans">): Promise<{ run: Doc<"runs">; pins: NonNullable<Doc<"runs">["contentPlanning"]> } | null> {
  const run = await ctx.db.get(plan.runId);
  return run?.contentPlanning ? { run, pins: run.contentPlanning } : null;
}

export type Resolved = { contentType: string; publishTargets: string[] };

/** Checks one item against the Project; returns what the Core fills in, or the reasons it is refused. */
export async function resolveItem(
  ctx: MutationCtx,
  run: Doc<"runs">,
  pins: NonNullable<Doc<"runs">["contentPlanning"]>,
  item: Pick<PlannedItem, "missionType" | "recipeId" | "sourceId">,
  at: string,
  publishers: readonly ProjectPublisher[],
): Promise<{ ok: true; value: Resolved; uncertain: Array<{ target: string; reason: string }> } | { ok: false; errors: string[] }> {
  const recipeId = ctx.db.normalizeId("productionRecipes", item.recipeId);
  const recipe = recipeId ? await ctx.db.get(recipeId) : null;
  if (!recipe || recipe.instanceId !== run.instanceId) return { ok: false, errors: [`${at}: recipeId does not name a Recipe of this Project.`] };
  if (recipe.missionType !== item.missionType) {
    return { ok: false, errors: [`${at}: the Recipe is written for Mission type "${recipe.missionType}", not "${item.missionType}".`] };
  }
  const agent = await ctx.db
    .query("projectAgents")
    .withIndex("by_instance_template", (q) => q.eq("instanceId", run.instanceId).eq("templateId", recipe.templateId))
    .unique();
  if (!agent || agent.status !== "active" || (agent.hiddenMissionTypes ?? []).includes(item.missionType)) {
    return { ok: false, errors: [`${at}: no active Agent offers Mission type "${item.missionType}".`] };
  }
  // The one Recipe Compatibility rule of Mission creation: same Project, Template and Mission type, and the type is creative.
  try {
    await assertRecipeCompatible(ctx, { instanceId: run.instanceId, templateId: recipe.templateId, type: item.missionType, pinnedVersion: undefined, recipeId: recipe._id });
  } catch (error) {
    return { ok: false, errors: [`${at}: ${error instanceof Error ? error.message : "the Recipe is not compatible"}.`] };
  }
  const template = await getTemplateRegistry(ctx).resolve(run.instanceId, recipe.templateId);
  const manifestType = template?.manifest.missionTypes?.find((entry) => entry.type === item.missionType);
  const declaration = publishDeclarationFor(template?.manifest, item.missionType);
  if (!manifestType || !declaration) return { ok: false, errors: [`${at}: Mission type "${item.missionType}" declares no publishing, so it has no Content Type and cannot be planned.`] };
  const pinned = pins.targets.find((entry) => entry.contentType === declaration.kind);
  if (!pinned) return { ok: false, errors: [`${at}: Content Type "${declaration.kind}" has no Production target.`] };

  const errors: string[] = [];
  if (contentTypeOf(manifestType, template?.manifest.contextProviders).sourceRequired && item.sourceId === undefined) errors.push(`${at}: Mission type "${item.missionType}" needs a Source (sourceId).`);
  if (item.sourceId !== undefined) {
    const sourceId = ctx.db.normalizeId("sources", item.sourceId);
    const source = sourceId ? await ctx.db.get(sourceId) : null;
    if (!source || source.instanceId !== run.instanceId) errors.push(`${at}: sourceId does not name a Source of this Project.`);
  }

  // The destinations are the user's pinned ones for this Content Type; a channel removed since is left out.
  const publishTargets: string[] = [];
  const uncertain: Array<{ target: string; reason: string }> = [];
  for (const target of pinned.publishTargets) {
    const found = channelOf(publishers, target);
    if (!found) continue;
    publishTargets.push(target);
    const capability = await capabilityOfTarget(ctx, found, declaration.kind, declaration.platforms);
    if (capability.level === "unsupported") errors.push(`${at}: ${capability.reason} (channel "${target}").`);
    else if (capability.level === "uncertain") uncertain.push({ target, reason: capability.reason ?? "" });
  }
  // A content is never kept without a destination: every pinned channel may have been removed since dispatch.
  if (publishTargets.length === 0) errors.push(`${at}: no Publish target of Content Type "${declaration.kind}" is available any more.`);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { contentType: declaration.kind, publishTargets }, uncertain };
}

/**
 * Validates and persists the result of a Content Planning Run. Idempotent: the plan already persisted for the Run is
 * returned, and a Run already completed (an empty result creates no plan) changes nothing. The same mutation
 * checks for a draft and inserts, so two concurrent completions cannot produce two drafts.
 */
export async function persistContentPlan(ctx: MutationCtx, run: Doc<"runs">, envelope: unknown): Promise<PersistPlanResult> {
  const pins = run.contentPlanning;
  if (!pins) return invalid(["The Run carries no Planning period."]);
  const existing = await ctx.db.query("contentPlans").withIndex("by_instance_run", (q) => q.eq("instanceId", run.instanceId).eq("runId", run._id)).first();
  if (existing) return { ok: true, planId: existing._id, created: false, count: 0, uncertain: [] };
  if (run.status === "completed") return { ok: true, planId: null, created: false, count: 0, uncertain: [] };

  const parsed = parseContentPlanEnvelope(envelope, pins);
  if (!parsed.ok) return invalid(parsed.errors);
  const { rationale, items } = parsed.value;
  if (items.length === 0) return { ok: true, planId: null, created: false, count: 0, uncertain: [], rationale };

  const draft = await ctx.db.query("contentPlans").withIndex("by_instance_status", (q) => q.eq("instanceId", run.instanceId).eq("status", "draft")).first();
  if (draft) return { ok: false, reason: "draft_exists", message: "A draft Content Plan is waiting for review: approve or reject it before a new one is planned." };

  const publishers = await projectPublishers(ctx, run.instanceId);
  const errors: string[] = [];
  const resolved: Resolved[] = [];
  const uncertain: Array<{ index: number; target: string; reason: string }> = [];
  for (const [index, item] of items.entries()) {
    const outcome = await resolveItem(ctx, run, pins, item, `items[${index}]`, publishers);
    if (outcome.ok) {
      resolved.push(outcome.value);
      uncertain.push(...outcome.uncertain.map((entry) => ({ index, ...entry })));
    } else errors.push(...outcome.errors);
  }
  if (errors.length === 0) {
    for (const [contentType, count] of countByContentType(resolved)) {
      const remaining = pins.targets.find((entry) => entry.contentType === contentType)?.remaining ?? 0;
      if (count > remaining) errors.push(`Content Type "${contentType}": ${count} contents proposed but only ${remaining} remain to plan.`);
    }
  }
  if (errors.length > 0) return invalid(errors);

  const now = Date.now();
  const planId = await ctx.db.insert("contentPlans", {
    ownerId: run.ownerId, instanceId: run.instanceId, runId: run._id, periodStart: pins.periodStart, periodEnd: pins.periodEnd,
    rationale, status: "draft", createdAt: now,
  });
  for (const [index, item] of items.entries()) {
    await ctx.db.insert("plannedContents", {
      ownerId: run.ownerId, instanceId: run.instanceId, planId, contentType: resolved[index]!.contentType, missionType: item.missionType,
      recipeId: ctx.db.normalizeId("productionRecipes", item.recipeId)!,
      ...(item.sourceId !== undefined ? { sourceId: ctx.db.normalizeId("sources", item.sourceId)! } : {}),
      publishTargets: resolved[index]!.publishTargets, title: item.title, brief: item.brief, plannedAt: item.plannedAt,
      intent: item.intent, rationale: item.rationale, status: "proposed", createdAt: now,
    });
  }
  return { ok: true, planId, created: true, count: items.length, uncertain };
}
