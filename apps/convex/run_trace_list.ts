import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server.js";
import { runStatusV } from "./validators.js";
import { runParent } from "./run_parent.js";

// The Trace list (#205): recent Runs of Missions and Jobs across the caller's
// Projects. Read-only; never returns a Run's `sessionKey`.

const cursorV = v.object({ createdAt: v.number(), creationTime: v.number() });
type Cursor = { createdAt: number; creationTime: number };

const MAX_LIMIT = 100;

/** Instances (by `openclawId`, with their Project's name) the caller owns. */
async function ownedInstances(ctx: QueryCtx): Promise<Map<string, string | undefined>> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authentication required");
  const owned = new Map<string, string | undefined>();
  // Better Auth may persist either representation as the Project's owner.
  for (const ownerId of new Set([identity.subject, identity.tokenIdentifier])) {
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_owner_id", (q) => q.eq("ownerId", ownerId))
      .collect();
    for (const project of projects) {
      const instances = await ctx.db
        .query("instances")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect();
      for (const instance of instances) {
        if (instance.openclawId) owned.set(instance.openclawId, project.displayName);
      }
    }
  }
  return owned;
}

export const listRecent = query({
  args: {
    limit: v.number(),
    cursor: v.optional(cursorV),
    instanceId: v.optional(v.string()),
    templateId: v.optional(v.string()),
    status: v.optional(runStatusV),
  },
  handler: async (ctx, args) => {
    const owned = await ownedInstances(ctx);
    const limit = Math.max(1, Math.min(Math.floor(args.limit), MAX_LIMIT));
    const instanceIds = [...owned.keys()].filter((id) => args.instanceId === undefined || id === args.instanceId);
    const { cursor, templateId, status } = args;

    const perInstance = await Promise.all(
      instanceIds.map(async (instanceId) =>
        ctx.db
          .query("runs")
          .withIndex("by_instance_created", (q) =>
            cursor ? q.eq("instanceId", instanceId).lte("createdAt", cursor.createdAt) : q.eq("instanceId", instanceId),
          )
          .order("desc")
          .filter((q) =>
            q.and(
              cursor === undefined
                ? q.eq(true, true)
                : q.or(
                    q.lt(q.field("createdAt"), cursor.createdAt),
                    q.and(q.eq(q.field("createdAt"), cursor.createdAt), q.lt(q.field("_creationTime"), cursor.creationTime)),
                  ),
              templateId === undefined ? q.eq(true, true) : q.eq(q.field("templateId"), templateId),
              status === undefined ? q.eq(true, true) : q.eq(q.field("status"), status),
            ),
          )
          .take(limit + 1),
      ),
    );
    const merged = perInstance
      .flat()
      .sort((a, b) => b.createdAt - a.createdAt || b._creationTime - a._creationTime);
    const page = merged.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor: Cursor | null =
      merged.length > limit && last ? { createdAt: last.createdAt, creationTime: last._creationTime } : null;

    const items = await Promise.all(
      page.map(async (run) => {
        const parent = runParent(run);
        // A Standalone Run (ADR-087) has no Mission or Job to name it.
        const name =
          parent.kind === "mission"
            ? ((await ctx.db.get(parent.missionId))?.type ?? null)
            : parent.kind === "job"
              ? ((await ctx.db.get(parent.jobId))?.type ?? null)
              : null;
        return {
          runId: run._id,
          kind: parent.kind,
          missionId: parent.kind === "mission" ? parent.missionId : null,
          name,
          instanceId: run.instanceId,
          projectName: owned.get(run.instanceId) ?? null,
          templateId: run.templateId,
          agentName: run.agentName,
          status: run.status,
          createdAt: run.createdAt,
          completedAt: run.completedAt ?? null,
        };
      }),
    );
    return { items, nextCursor };
  },
});

/** The Projects the Trace list can be filtered by, and the Agents of the selected Project (all Projects when none). */
export const filterOptions = query({
  args: { instanceId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const owned = await ownedInstances(ctx);
    const projects = [...owned].map(([instanceId, name]) => ({ instanceId, name: name ?? instanceId }));
    const agents = new Map<string, string>();
    for (const instanceId of owned.keys()) {
      if (args.instanceId !== undefined && instanceId !== args.instanceId) continue;
      const rows = await ctx.db
        .query("projectAgents")
        .withIndex("by_instance_template", (q) => q.eq("instanceId", instanceId))
        .collect();
      for (const row of rows) agents.set(row.templateId, row.openclawAgentName ?? row.templateId);
    }
    return {
      projects,
      agents: [...agents].map(([templateId, name]) => ({ templateId, name })),
    };
  },
});
