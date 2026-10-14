import { mutation, query, internalMutation, internalQuery, type QueryCtx } from "./_generated/server.js";
import { v } from "convex/values";
import { projectAgentSkillV, projectAgentStatusV } from "./validators.js";
import { upsertSkillEntry } from "@opengroow/agent-templates/skills";
import { syncJobsWithAgentStatus } from "./jobs.js";
import { ownerOfInstance } from "./projects.js";

export async function canReadInstance(ctx: QueryCtx, instanceId: string) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Authentication required");
  }

  const instance = await ctx.db
    .query("instances")
    .withIndex("by_openclaw_id", (q) => q.eq("openclawId", instanceId))
    .collect();
  if (instance.length !== 1) {
    return false;
  }

  const ownerId = await ownerOfInstance(ctx, instance[0]);
  if (!ownerId) {
    return true;
  }
  if (ownerId !== identity.tokenIdentifier && ownerId !== identity.subject) {
    return false;
  }
  return true;
}

export const upsert = internalMutation({
  args: {
    instanceId: v.string(),
    templateId: v.string(),
    status: projectAgentStatusV,
    workspaceKey: v.optional(v.string()),
    openclawAgentName: v.optional(v.string()),
    mcpServerKeys: v.optional(v.array(v.string())),
    errorMessage: v.optional(v.string()),
    // Omitting this on a call clears any previously stored link (same
    // "explicit undefined patches to absent" convention as errorMessage) —
    // e.g. an "active" upsert always clears a stale Config Completeness link.
    errorLink: v.optional(v.string()),
    config: v.optional(v.record(v.string(), v.any())),
    skills: v.optional(v.array(projectAgentSkillV)),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("projectAgents")
      .withIndex("by_instance_template", (q) =>
        q.eq("instanceId", args.instanceId).eq("templateId", args.templateId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        workspaceKey: args.workspaceKey ?? existing.workspaceKey,
        openclawAgentName: args.openclawAgentName ?? existing.openclawAgentName,
        mcpServerKeys: args.mcpServerKeys ?? existing.mcpServerKeys,
        errorMessage: args.errorMessage,
        errorLink: args.errorLink,
        config: args.config ?? existing.config,
        skills: args.skills ?? existing.skills,
        updatedAt: now,
      });
      await syncJobsWithAgentStatus(ctx, args);
      return existing._id;
    }

    const projectAgentId = await ctx.db.insert("projectAgents", {
      instanceId: args.instanceId,
      templateId: args.templateId,
      status: args.status,
      workspaceKey: args.workspaceKey,
      openclawAgentName: args.openclawAgentName,
      mcpServerKeys: args.mcpServerKeys ?? [],
      errorMessage: args.errorMessage,
      errorLink: args.errorLink,
      skills: args.skills,
      createdAt: now,
      updatedAt: now,
    });
    await syncJobsWithAgentStatus(ctx, args);
    return projectAgentId;
  },
});

/**
 * Creates the "activating" record of a new Agent, atomically refusing when
 * the Project already has an Agent of that Template (#655): a Project holds
 * at most one Agent per Template, and two concurrent "Add Agent" calls must
 * not both go on to provision it.
 */
export const claimNew = internalMutation({
  args: { instanceId: v.string(), templateId: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const existing = await ctx.db
      .query("projectAgents")
      .withIndex("by_instance_template", (q) =>
        q.eq("instanceId", args.instanceId).eq("templateId", args.templateId)
      )
      .unique();
    if (existing) return false;
    const now = Date.now();
    await ctx.db.insert("projectAgents", {
      instanceId: args.instanceId,
      templateId: args.templateId,
      status: "activating",
      mcpServerKeys: [],
      createdAt: now,
      updatedAt: now,
    });
    await syncJobsWithAgentStatus(ctx, { ...args, status: "activating" });
    return true;
  },
});

/**
 * Merge a single skill entry into `projectAgents.skills[]` (issue #224).
 *
 * `addAgentSkill` (apps/convex/project_agents_node.ts) reads `skills[]`
 * before awaiting the multi-second `clawhub install`, so a snapshot taken
 * before that await is stale by the time the install resolves — a
 * concurrent `refreshProjectAgent`/`reconcileTemplateSkills` write in that
 * window would otherwise be silently clobbered by writing the whole
 * pre-install array back with `upsert` (see
 * apps/convex/_generated/ai/guidelines.md on split read-modify-write races).
 *
 * This mutation re-reads `skills[]` inside its own transaction and merges
 * only the single new entry via `upsertSkillEntry`, so it never overwrites
 * skills that changed concurrently.
 */
export const upsertAgentSkill = internalMutation({
  args: {
    instanceId: v.string(),
    templateId: v.string(),
    skill: projectAgentSkillV,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("projectAgents")
      .withIndex("by_instance_template", (q) =>
        q.eq("instanceId", args.instanceId).eq("templateId", args.templateId)
      )
      .unique();

    if (!existing) {
      return { status: "not_found" as const };
    }

    const nextSkills = upsertSkillEntry(existing.skills ?? [], args.skill);
    await ctx.db.patch(existing._id, { skills: nextSkills, updatedAt: Date.now() });
    return { status: "ok" as const };
  },
});

export const getByInstanceAndTemplate = internalQuery({
  args: { instanceId: v.string(), templateId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projectAgents")
      .withIndex("by_instance_template", (q) =>
        q.eq("instanceId", args.instanceId).eq("templateId", args.templateId)
      )
      .unique();
  },
});

export const getByInstanceAndWorkspaceKey = internalQuery({
  args: { instanceId: v.string(), workspaceKey: v.string() },
  handler: async (ctx, args) => {
    const agents = await ctx.db
      .query("projectAgents")
      .withIndex("by_instance_template", (q) => q.eq("instanceId", args.instanceId))
      .collect();
    return agents.find((agent) => agent.workspaceKey === args.workspaceKey) ?? null;
  },
});

export const listActiveByInstance = internalQuery({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projectAgents")
      .withIndex("by_instance_status", (q) =>
        q.eq("instanceId", args.instanceId).eq("status", "active")
      )
      .collect();
  },
});

export const get = query({
  args: { instanceId: v.string(), templateId: v.string() },
  handler: async (ctx, args) => {
    if (!(await canReadInstance(ctx, args.instanceId))) {
      return null;
    }
    return await ctx.db
      .query("projectAgents")
      .withIndex("by_instance_template", (q) =>
        q.eq("instanceId", args.instanceId).eq("templateId", args.templateId)
      )
      .unique();
  },
});

/**
 * Sets the Mission types the operator hides from an Agent (ADR-053).
 * Presentation only: it filters the creation forms and the workspace files,
 * and is not a permission — existing Missions and Schedules are untouched.
 */
export const setHiddenMissionTypes = mutation({
  args: { instanceId: v.string(), templateId: v.string(), hiddenMissionTypes: v.array(v.string()) },
  handler: async (ctx, args) => {
    if (!(await canReadInstance(ctx, args.instanceId))) {
      throw new Error("Project not found or not accessible");
    }
    const agent = await ctx.db
      .query("projectAgents")
      .withIndex("by_instance_template", (q) => q.eq("instanceId", args.instanceId).eq("templateId", args.templateId))
      .unique();
    if (!agent) {
      throw new Error("Agent not found");
    }
    await ctx.db.patch(agent._id, { hiddenMissionTypes: [...new Set(args.hiddenMissionTypes)], updatedAt: Date.now() });
  },
});

export const markInactiveIfNoActiveRuns = internalMutation({
  args: { instanceId: v.string(), templateId: v.string() },
  handler: async (ctx, args): Promise<{ ok: true } | { ok: false; count: number }> => {
    let count = 0;
    for await (const _ of ctx.db
      .query("runs")
      .withIndex("by_instance_template_status", (q) =>
        q.eq("instanceId", args.instanceId).eq("templateId", args.templateId).eq("status", "dispatching"),
      )) count++;
    for await (const _ of ctx.db
      .query("runs")
      .withIndex("by_instance_template_status", (q) =>
        q.eq("instanceId", args.instanceId).eq("templateId", args.templateId).eq("status", "running"),
      )) count++;

    if (count > 0) return { ok: false, count };

    const existing = await ctx.db
      .query("projectAgents")
      .withIndex("by_instance_template", (q) =>
        q.eq("instanceId", args.instanceId).eq("templateId", args.templateId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { status: "inactive", updatedAt: Date.now() });
      await syncJobsWithAgentStatus(ctx, { ...args, status: "inactive" });
    }

    return { ok: true };
  },
});

export const listByInstance = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    if (!(await canReadInstance(ctx, args.instanceId))) {
      return [];
    }
    return await ctx.db
      .query("projectAgents")
      .withIndex("by_instance_template", (q) =>
        q.eq("instanceId", args.instanceId)
      )
      .collect();
  },
});
