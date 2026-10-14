import type { JobTypeName } from "@opengroow/agent-templates";
import { getTemplateRegistry } from "./template_registry.js";
import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { ownerIdsFor, requireOwnedRow } from "./instance_ownership.js";
import { ownerOfInstance } from "./projects.js";
import { frequencyV } from "./schedules.js";
import { computeNextRunAt, type Frequency } from "./schedules/frequency.js";

const DEFAULT_FREQUENCY: Frequency = { unit: "daily", hour: 6, minute: 0 };
const DEFAULT_TIMEZONE = "UTC";

const JOB_DISPLAY_ORDER: Record<string, number> = {
  source_ingestion: 0,
  source_scoring: 1,
  source_routing: 2,
};

function ownerSubjectOf(userId: string): string {
  return userId.slice(userId.lastIndexOf("|") + 1);
}

function frequencyOf(job: Doc<"jobs">): Frequency {
  return {
    unit: job.unit,
    ...(job.dayOfWeek !== undefined ? { dayOfWeek: job.dayOfWeek } : {}),
    ...(job.dayOfMonth !== undefined ? { dayOfMonth: job.dayOfMonth } : {}),
    hour: job.hour,
    minute: job.minute,
  };
}

const IN_FLIGHT_RUN_STATUSES: ReadonlySet<Doc<"runs">["status"]> = new Set([
  "pending",
  "dispatching",
  "running",
  "awaiting_job",
]);

function jobLabel(type: Doc<"jobs">["type"]): string {
  switch (type) {
    case "source_ingestion": return "Social source ingestion";
    case "source_scoring": return "Source scoring";
    case "source_routing": return "Source routing";
    default: return type;
  }
}

function inFlightRunId(job: Doc<"jobs">): Id<"runs"> | undefined {
  if (!job.runtime || typeof job.runtime !== "object" || Array.isArray(job.runtime)) return undefined;
  const value = (job.runtime as Record<string, unknown>).inFlightRunId;
  return typeof value === "string" ? value as Id<"runs"> : undefined;
}

function runtimeOf(job: Doc<"jobs">): Record<string, unknown> {
  return job.runtime && typeof job.runtime === "object" && !Array.isArray(job.runtime)
    ? job.runtime as Record<string, unknown>
    : {};
}

function compareJobsForDisplay(a: Doc<"jobs">, b: Doc<"jobs">): number {
  const typeOrder = (job: Doc<"jobs">) => JOB_DISPLAY_ORDER[job.type] ?? Number.MAX_SAFE_INTEGER;
  const byTypeOrder = typeOrder(a) - typeOrder(b);
  if (byTypeOrder !== 0) return byTypeOrder;

  const byTemplate = a.templateId.localeCompare(b.templateId);
  if (byTemplate !== 0) return byTemplate;

  const byType = a.type.localeCompare(b.type);
  if (byType !== 0) return byType;

  const byCreatedAt = a.createdAt - b.createdAt;
  return byCreatedAt !== 0 ? byCreatedAt : a._id.localeCompare(b._id);
}

function assertValidFrequency(frequency: Frequency): void {
  const inRange = (value: number | undefined, min: number, max: number) =>
    value !== undefined && Number.isInteger(value) && value >= min && value <= max;
  if (!inRange(frequency.hour, 0, 23) || !inRange(frequency.minute, 0, 59)) {
    throw new Error("Invalid time of day");
  }
  if (frequency.unit === "weekly" && !inRange(frequency.dayOfWeek, 0, 6)) {
    throw new Error("Invalid day of week");
  }
  if (frequency.unit === "monthly" && !inRange(frequency.dayOfMonth, 1, 31)) {
    throw new Error("Invalid day of month");
  }
}

async function findJob(ctx: MutationCtx, instanceId: string, templateId: string, type: JobTypeName) {
  return await ctx.db
    .query("jobs")
    .withIndex("by_instance_type_template", (q) =>
      q.eq("instanceId", instanceId).eq("type", type).eq("templateId", templateId),
    )
    .unique();
}

/** Provision the explicit Job capabilities declared by an Agent Template. */
export async function syncJobsWithAgentStatus(
  ctx: MutationCtx,
  agent: { instanceId: string; templateId: string; status: Doc<"projectAgents">["status"] },
): Promise<void> {
  const instance = await ctx.db
    .query("instances")
    .withIndex("by_openclaw_id", (q) => q.eq("openclawId", agent.instanceId))
    .unique();
  const instanceOwner = instance ? await ownerOfInstance(ctx, instance) : undefined;
  if (!instanceOwner) return;
  const ownerId = ownerSubjectOf(instanceOwner);

  const now = Date.now();
  if (agent.status === "inactive") {
    for await (const job of ctx.db
      .query("jobs")
      .withIndex("by_instance_template", (q) =>
        q.eq("instanceId", agent.instanceId).eq("templateId", agent.templateId),
      )) {
      if (job.state === "active") await ctx.db.patch(job._id, { state: "paused", updatedAt: now });
    }
    return;
  }
  if (agent.status !== "active") return;

  // The Instance id identifies the Project the Template is resolved for.
  const declarations = (await getTemplateRegistry(ctx).resolve(agent.instanceId, agent.templateId))?.manifest.jobTypes ?? [];
  for (const declaration of declarations) {
    const existing = await findJob(ctx, agent.instanceId, agent.templateId, declaration.type);
    if (existing) {
      if (existing.ownerId !== ownerId) {
        await ctx.db.patch(existing._id, { ownerId, updatedAt: now });
      }
      continue;
    }

    await ctx.db.insert("jobs", {
      ownerId,
      instanceId: agent.instanceId,
      templateId: agent.templateId,
      type: declaration.type,
      state: "active",
      config: {},
      runtime: declaration.type === "source_ingestion" ? { cursorAt: now } : {},
      unit: DEFAULT_FREQUENCY.unit,
      hour: DEFAULT_FREQUENCY.hour,
      minute: DEFAULT_FREQUENCY.minute,
      timezone: DEFAULT_TIMEZONE,
      nextRunAt: computeNextRunAt(DEFAULT_FREQUENCY, DEFAULT_TIMEZONE, now),
      createdAt: now,
      updatedAt: now,
    });
  }
}

export const listByInstance = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    const ownerIds = await ownerIdsFor(ctx, args.instanceId);
    if (ownerIds === null) return [];

    const jobs = new Map<Id<"jobs">, Doc<"jobs">>();
    for (const ownerId of ownerIds) {
      const rows = await ctx.db
        .query("jobs")
        .withIndex("by_instance_owner", (q) => q.eq("instanceId", args.instanceId).eq("ownerId", ownerId))
        .take(100);
      for (const row of rows) jobs.set(row._id, row);
    }

    return await Promise.all([...jobs.values()]
      .sort(compareJobsForDisplay)
      .map(async (job) => {
        const agent = await ctx.db.query("projectAgents").withIndex("by_instance_template", (q) =>
          q.eq("instanceId", job.instanceId).eq("templateId", job.templateId),
        ).unique();
        const runId = inFlightRunId(job);
        const run = runId ? await ctx.db.get(runId) : null;
        const latestRun = await ctx.db.query("runs").withIndex("by_job", (q) => q.eq("jobId", job._id)).order("desc").first();
        return {
          _id: job._id,
          type: job.type,
          jobType: job.type,
          label: jobLabel(job.type),
          agentName: jobLabel(job.type),
          templateId: job.templateId,
          state: job.state,
          config: job.config,
          runtime: job.runtime,
          unit: job.unit,
          dayOfWeek: job.dayOfWeek,
          dayOfMonth: job.dayOfMonth,
          hour: job.hour,
          minute: job.minute,
          timezone: job.timezone,
          nextRunAt: job.nextRunAt,
          lastRunAt: job.lastRunAt,
          lastOutcome: job.lastOutcome,
          lastSummary: job.lastSummary,
          lastError: job.lastError,
          latestRunId: latestRun?._id ?? job.latestRunId,
          workspaceKey: agent?.workspaceKey,
          running: run !== null && IN_FLIGHT_RUN_STATUSES.has(run.status),
        };
      }));
  },
});

async function loadOwnedJob(ctx: MutationCtx, jobId: Id<"jobs">): Promise<Doc<"jobs">> {
  const job = await ctx.db.get(jobId);
  if (!job) throw new Error("Forbidden");
  await requireOwnedRow(ctx, job);
  return job;
}

export const setFrequency = mutation({
  args: { jobId: v.id("jobs"), frequency: frequencyV, timezone: v.string() },
  handler: async (ctx, args) => {
    const job = await loadOwnedJob(ctx, args.jobId);
    const frequency = args.frequency as Frequency;
    assertValidFrequency(frequency);
    const now = Date.now();
    await ctx.db.patch(job._id, {
      unit: frequency.unit,
      dayOfWeek: frequency.unit === "weekly" ? frequency.dayOfWeek : undefined,
      dayOfMonth: frequency.unit === "monthly" ? frequency.dayOfMonth : undefined,
      hour: frequency.hour,
      minute: frequency.minute,
      timezone: args.timezone,
      nextRunAt: computeNextRunAt(frequency, args.timezone, now),
      updatedAt: now,
    });
  },
});

export const pause = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await loadOwnedJob(ctx, args.jobId);
    await ctx.db.patch(job._id, { state: "paused", updatedAt: Date.now() });
  },
});

export const resume = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await loadOwnedJob(ctx, args.jobId);
    const now = Date.now();
    const runtime = runtimeOf(job);
    const hasQueuedRun = job.runNowAt !== undefined;
    await ctx.db.patch(job._id, {
      state: "active",
      nextRunAt: computeNextRunAt(frequencyOf(job), job.timezone, now),
      ...(hasQueuedRun ? { runNowAt: job.runNowAt } : { runNowAt: undefined }),
      runtime: hasQueuedRun
        ? { ...runtime, runNowRestorePaused: false }
        : { ...runtime, runNowRequestedAt: undefined, runNowRestorePaused: undefined },
      updatedAt: now,
    });
  },
});

/** Mark a Job due immediately; the type-specific executor consumes this claim. */
export const runNow = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await loadOwnedJob(ctx, args.jobId);
    const runId = inFlightRunId(job);
    if (runId) {
      const run = await ctx.db.get(runId);
      if (run && IN_FLIGHT_RUN_STATUSES.has(run.status)) throw new Error("This job is already running.");
    }
    const now = Date.now();
    await ctx.db.patch(job._id, {
      nextRunAt: now,
      runNowAt: now,
      runtime: {
        ...runtimeOf(job),
        runNowRequestedAt: now,
        runNowRestorePaused: job.state === "paused",
      },
      updatedAt: now,
    });
    if (job.type === "source_ingestion") {
      await ctx.scheduler.runAfter(0, internal.source_jobs.tick, {});
    } else if (job.type === "source_scoring") {
      await ctx.scheduler.runAfter(0, internal.score_jobs.tick, {});
    } else if (job.type === "source_routing") {
      await ctx.scheduler.runAfter(0, internal.source_routing.tick, {});
    } else {
      throw new Error(`Job type ${job.type} has no executor yet`);
    }
    return { status: "queued" as const };
  },
});

/** Internal helper for the later type-specific executors to record a Run. */
export const recordRun = internalMutation({
  args: { jobId: v.id("jobs"), runId: v.id("runs"), now: v.number() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return;
    await ctx.db.patch(job._id, { latestRunId: args.runId, lastRunAt: args.now, updatedAt: args.now });
  },
});
