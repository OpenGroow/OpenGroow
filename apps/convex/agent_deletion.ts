import { v } from "convex/values";
import type { GenericId } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server.js";
import type { TableNames } from "./_generated/dataModel.js";

/** Documents deleted per call: each mutation stays well under Convex's write and read limits. */
const BATCH = 64;

/** Statuses of a Run that is not finished; the same as `runs.countActiveByInstanceTemplate`. */
const LIVE_RUN_STATUSES = ["pending", "dispatching", "running", "awaiting_job"] as const;

/**
 * One step of `deleteProjectAgent`: deletes up to `BATCH` documents belonging
 * to the Agent of `templateId` in the Project, children before parents, and
 * says whether anything is left. The caller loops until `done`.
 *
 * Order: Runs (with their reconcile events), Publications and Missions,
 * Schedules, Jobs, installed Template versions (with their files), MCP URL
 * overrides, then the Agent row. Sources are kept: they are append-only and
 * outlive the Missions that produced them (ADR-051), like `deleteMission`.
 * Refused while one of its Runs is live (pending, dispatching, running or
 * awaiting an external job, as `runs.countActiveByInstanceTemplate` counts
 * them): its callback, poll or claim would reference a deleted Run.
 */
export const purgeBatch = internalMutation({
  args: { instanceId: v.string(), templateId: v.string() },
  handler: async (ctx, { instanceId, templateId }): Promise<{ done: boolean }> => {
    for (const status of LIVE_RUN_STATUSES) {
      const live = await ctx.db
        .query("runs")
        .withIndex("by_instance_template_status", (q) =>
          q.eq("instanceId", instanceId).eq("templateId", templateId).eq("status", status),
        )
        .first();
      if (live) throw new Error("Cannot delete the Agent while one of its Runs is in flight; try again once it ends");
    }

    let budget = BATCH;
    const remove = async (id: GenericId<TableNames>) => {
      await ctx.db.delete(id);
      budget--;
    };

    // Runs of the Template (Mission and Job Runs), each with its reconcile events.
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_instance_template_created", (q) => q.eq("instanceId", instanceId).eq("templateId", templateId))
      .take(budget);
    for (const run of runs) {
      if (!(await removeChildren(ctx, "runReconcileEvents", "by_run_created", "runId", run._id, () => budget, remove))) {
        return { done: false };
      }
      if (budget <= 0) return { done: false };
      await remove(run._id);
    }
    if (budget <= 0) return { done: false };

    // Missions, each with its Publications.
    const missions = await ctx.db
      .query("missions")
      .withIndex("by_instance_template", (q) => q.eq("instanceId", instanceId).eq("templateId", templateId))
      .take(budget);
    for (const mission of missions) {
      if (!(await removeChildren(ctx, "publications", "by_mission", "missionId", mission._id, () => budget, remove))) {
        return { done: false };
      }
      if (budget <= 0) return { done: false };
      await remove(mission._id);
    }
    if (budget <= 0) return { done: false };

    for (const table of ["schedules", "jobs"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_instance_template", (q) => q.eq("instanceId", instanceId).eq("templateId", templateId))
        .take(budget);
      for (const row of rows) await remove(row._id);
      if (budget <= 0) return { done: false };
    }

    // Every stored version of the Template (current, older, offered), each with its files.
    const versions = await ctx.db
      .query("installedTemplates")
      .withIndex("by_project_template", (q) => q.eq("projectId", instanceId).eq("templateId", templateId))
      .take(budget);
    for (const version of versions) {
      if (!(await removeChildren(ctx, "templateFiles", "by_installed_template", "installedTemplateId", version._id, () => budget, remove))) {
        return { done: false };
      }
      if (budget <= 0) return { done: false };
      await remove(version._id);
    }
    if (budget <= 0) return { done: false };

    const overrides = await ctx.db
      .query("templateMcpUrlOverrides")
      .withIndex("by_project_template", (q) => q.eq("projectId", instanceId).eq("templateId", templateId))
      .take(budget);
    for (const row of overrides) await remove(row._id);
    if (budget <= 0) return { done: false };

    const agent = await ctx.db
      .query("projectAgents")
      .withIndex("by_instance_template", (q) => q.eq("instanceId", instanceId).eq("templateId", templateId))
      .unique();
    if (agent) await remove(agent._id);
    return { done: true };
  },
});

/** Deletes the children of one parent within the remaining budget; true when none is left. */
async function removeChildren(
  ctx: MutationCtx,
  table: "runReconcileEvents" | "publications" | "templateFiles",
  index: string,
  field: string,
  parentId: GenericId<TableNames>,
  budget: () => number,
  remove: (id: GenericId<TableNames>) => Promise<void>,
): Promise<boolean> {
  // The three (table, index, field) pairs are fixed above; the query builder cannot type them generically.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = (ctx.db.query(table) as any).withIndex(index, (q: any) => q.eq(field, parentId));
  const children: Array<{ _id: GenericId<TableNames> }> = await query.take(Math.max(budget(), 0) + 1);
  for (const child of children) {
    if (budget() <= 0) return false;
    await remove(child._id);
  }
  return true;
}
