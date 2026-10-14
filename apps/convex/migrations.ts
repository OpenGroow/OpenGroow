import {
  Migrations,
  runToCompletion,
  type MigrationFunctionReference,
} from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { enqueueCommand } from "./commands";
import { RUNTIME_WORKSPACE_FILE_DELETE_BATCH } from "@opengroow/protocol";
import schema from "./schema";

export const migrations = new Migrations(components.migrations, { schema });

/**
 * Issue #537: the `enrich_observations` Mission type no longer exists. Deletes
 * those Missions together with everything the schema hangs off them: their
 * Runs (`runs.by_mission`) and those Runs' reconcile events
 * (`runReconcileEvents.by_run_created`). Other Missions, and Runs without a
 * Mission (SourceJob executions), are untouched. Idempotent.
 */
export const deleteEnrichObservationsMissions = migrations.define({
  table: "missions",
  migrateOne: async (ctx, mission) => {
    if (mission.type !== "enrich_observations") return;
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_mission", (q) => q.eq("missionId", mission._id))
      .collect();
    for (const run of runs) {
      const events = await ctx.db
        .query("runReconcileEvents")
        .withIndex("by_run_created", (q) => q.eq("runId", run._id))
        .collect();
      for (const event of events) await ctx.db.delete(event._id);
      await ctx.db.delete(run._id);
    }
    await ctx.db.delete(mission._id);
  },
});

/**
 * Issue #537: the sibling of `deleteEnrichObservationsMissions`, for the
 * `schedules` table. A Schedule of type `enrich_observations` would keep
 * creating Missions of a type that left the manifest, so it is deleted (the
 * schema hangs nothing else off a Schedule). On every remaining Schedule, a
 * `lastMissionId` pointing to a Mission that no longer exists (the deleted
 * `enrich_observations` Missions) is reset to undefined. Reads the Mission
 * rather than assuming the deletion ran, so it is order-independent, and it
 * is idempotent. Registered after the Missions migration.
 */
export const cleanEnrichObservationsSchedules = migrations.define({
  table: "schedules",
  migrateOne: async (ctx, schedule) => {
    if (schedule.type === "enrich_observations") {
      await ctx.db.delete(schedule._id);
      return;
    }
    if (schedule.lastMissionId && !(await ctx.db.get(schedule.lastMissionId))) {
      await ctx.db.patch(schedule._id, { lastMissionId: undefined });
    }
  },
});

const RETIRED_SOURCE_MISSION_TYPES = new Set([
  "score",
  "routing",
  "score_observation",
  "plan_observation_production",
]);

/**
 * Issue #601: Sources can carry both the old technical routing Mission and the
 * real producing Mission. Keep the producing Mission as the single active
 * pointer, and clear the two obsolete claim fields. A technical pointer with
 * no surviving producing Mission is discarded.
 */
export const migrateLegacySourceMissionReferences = migrations.define({
  table: "sources",
  migrateOne: async (ctx, source) => {
    const delegate = source.delegateMissionId ? await ctx.db.get(source.delegateMissionId) : null;
    const production = source.productionMissionId ? await ctx.db.get(source.productionMissionId) : null;
    const productionIsRetired = production ? RETIRED_SOURCE_MISSION_TYPES.has(production.type) : false;
    const nextProduction = delegate ?? (productionIsRetired ? null : production);
    await ctx.db.patch(source._id, {
      productionMissionId: nextProduction?._id,
      scoreMissionId: undefined,
      delegateMissionId: undefined,
    });
  },
});

/** Issue #601: delete technical Source Missions and all dependent Run records. */
export const deleteLegacySourceMissions = migrations.define({
  table: "missions",
  migrateOne: async (ctx, mission) => {
    if (!RETIRED_SOURCE_MISSION_TYPES.has(mission.type)) return;
    for (;;) {
      const runs = await ctx.db.query("runs").withIndex("by_mission", (q) => q.eq("missionId", mission._id)).take(100);
      if (runs.length === 0) break;
      for (const run of runs) {
        for (;;) {
          const events = await ctx.db.query("runReconcileEvents").withIndex("by_run_created", (q) => q.eq("runId", run._id)).take(100);
          if (events.length === 0) break;
          for (const event of events) await ctx.db.delete(event._id);
        }
        await ctx.db.delete(run._id);
      }
    }
    await ctx.db.delete(mission._id);
  },
});

const LEGACY_WORKSPACE_FILES = [
  "score.md",
  "routing.md",
  "score_observation.md",
  "plan_observation_production.md",
  "enrich_observations.md",
];

export const listLegacyWorkspaceCleanupBatch = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("projectAgents").paginate({ numItems: 100, cursor: args.cursor ?? null });
    return {
      ids: page.page.filter((agent) => agent.workspaceKey && agent.legacyWorkspaceCleanupAt === undefined).map((agent) => agent._id),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const queueLegacyWorkspaceCleanupBatch = internalMutation({
  args: { id: v.id("projectAgents") },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.id);
    if (!agent?.workspaceKey || agent.legacyWorkspaceCleanupAt !== undefined) return true;
    const page = await ctx.db.query("runs").withIndex("by_instance_template_created", (q) =>
      q.eq("instanceId", agent.instanceId).eq("templateId", agent.templateId),
    ).paginate({ numItems: 100, cursor: agent.legacyWorkspaceCleanupCursor ?? null });
    const filePaths = [
      ...(agent.legacyWorkspaceCleanupCursor === undefined ? LEGACY_WORKSPACE_FILES : []),
      ...page.page.flatMap((run) => [`runs/${run._id}.md`, `runs/${run._id}.json`]),
    ];
    await enqueueCommand(ctx, {
      instanceId: agent.instanceId,
      type: RUNTIME_WORKSPACE_FILE_DELETE_BATCH,
      payload: { workspaceKey: agent.workspaceKey, filePaths },
    });
    if (page.isDone) {
      await ctx.db.patch(args.id, { legacyWorkspaceCleanupAt: Date.now(), legacyWorkspaceCleanupCursor: undefined });
      return true;
    }
    await ctx.db.patch(args.id, { legacyWorkspaceCleanupCursor: page.continueCursor });
    return false;
  },
});

export const cleanupLegacyWorkspaceArtifacts = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | undefined;
    for (;;) {
      const batch = await ctx.runQuery(internal.migrations.listLegacyWorkspaceCleanupBatch, { cursor });
      if (batch.ids.length > 0) {
        for (const id of batch.ids) {
          let done = false;
          while (!done) {
            done = await ctx.runMutation(internal.migrations.queueLegacyWorkspaceCleanupBatch, { id });
          }
        }
      }
      if (batch.isDone) break;
      cursor = batch.continueCursor;
    }
  },
});

// Append each breaking schema change's migration here. The bootstrap
// sequence (apps/convex/docker/bootstrap/entrypoint.sh) calls `runAll`
// after every `npx convex deploy`, so self-hosters never run a migration
// command themselves — the next `docker compose up` picks up whatever a
// OpenGroow developer added to this list.
// Retiring the `insights` table (issue #485) is deliberately absent from this
// list. `migrations.define` types its `table` against `schema`, so a table can
// only be drained while it is still declared — once it leaves `schema.ts` its
// documents are simply orphaned: unreachable from every query, unvalidated,
// costing only storage. Draining first would have meant shipping the deletion
// across two releases for no correctness gain. If those rows ever need to
// actually go, re-declare `insights` in `schema.ts`, append a delete-all
// migration here, then remove the table again in the following release.
//
/**
 * Two Agent Templates were renamed: `video` -> `video-demo` and
 * `moneyprinterturbo-agent` -> `moneyprinterturbo`. Every row that stores the
 * old Template id (`templateId`) is rewritten. Idempotent: rows already on a
 * new id are untouched.
 * `openclawAgentName` (and `runs.agentName`, copied from it) is deliberately
 * NOT rewritten: it names the agent registered in the OpenClaw gateway, which
 * keeps the old name until the Agent is re-activated (activation registers the
 * new one and sets `openclawAgentName` itself). Rewriting it earlier would make
 * Missions of already-active Agents dispatch to an agent the gateway does not
 * know.
 */
const RENAMED_TEMPLATE_IDS: Record<string, string> = {
  video: "video-demo",
  "moneyprinterturbo-agent": "moneyprinterturbo",
};

const RENAMED_CAROUSEL_TEMPLATE_IDS: Record<string, string> = {
  "carousel-mcp": "visual-social",
};

const renamedTemplateId = (
  id: string,
  renames: Record<string, string> = RENAMED_TEMPLATE_IDS,
): string => renames[id] ?? id;

export const renameTemplateIdsInProjectAgents = migrations.define({
  table: "projectAgents",
  migrateOne: async (ctx, row) => {
    const templateId = renamedTemplateId(row.templateId);
    if (templateId !== row.templateId) await ctx.db.patch(row._id, { templateId });
  },
});

export const renameTemplateIdsInMissions = migrations.define({
  table: "missions",
  migrateOne: async (ctx, row) => {
    const templateId = renamedTemplateId(row.templateId);
    if (templateId !== row.templateId) await ctx.db.patch(row._id, { templateId });
  },
});

export const renameTemplateIdsInJobs = migrations.define({
  table: "jobs",
  migrateOne: async (ctx, row) => {
    const templateId = renamedTemplateId(row.templateId);
    if (templateId !== row.templateId) await ctx.db.patch(row._id, { templateId });
  },
});

export const renameTemplateIdsInSchedules = migrations.define({
  table: "schedules",
  migrateOne: async (ctx, row) => {
    const templateId = renamedTemplateId(row.templateId);
    if (templateId !== row.templateId) await ctx.db.patch(row._id, { templateId });
  },
});

export const renameTemplateIdsInSources = migrations.define({
  table: "sources",
  migrateOne: async (ctx, row) => {
    const templateId = renamedTemplateId(row.templateId);
    if (templateId !== row.templateId) await ctx.db.patch(row._id, { templateId });
  },
});

export const renameTemplateIdsInRuns = migrations.define({
  table: "runs",
  migrateOne: async (ctx, row) => {
    const templateId = renamedTemplateId(row.templateId);
    if (templateId !== row.templateId) await ctx.db.patch(row._id, { templateId });
  },
});

/**
 * The `carousel-mcp` Template became `visual-social` (the MCP server it talks
 * to is still called `carousel-mcp`). Same rewrite as the migrations above, as
 * separate migrations because those have already run and are tracked by name.
 * As above, `openclawAgentName` / `runs.agentName` keep the gateway's old
 * `carousel-mcp` agent name until the Agent is re-activated.
 */
export const renameCarouselTemplateIdInProjectAgents = migrations.define({
  table: "projectAgents",
  migrateOne: async (ctx, row) => {
    const templateId = renamedTemplateId(row.templateId, RENAMED_CAROUSEL_TEMPLATE_IDS);
    if (templateId !== row.templateId) await ctx.db.patch(row._id, { templateId });
  },
});

export const renameCarouselTemplateIdInMissions = migrations.define({
  table: "missions",
  migrateOne: async (ctx, row) => {
    const templateId = renamedTemplateId(row.templateId, RENAMED_CAROUSEL_TEMPLATE_IDS);
    if (templateId !== row.templateId) await ctx.db.patch(row._id, { templateId });
  },
});

export const renameCarouselTemplateIdInJobs = migrations.define({
  table: "jobs",
  migrateOne: async (ctx, row) => {
    const templateId = renamedTemplateId(row.templateId, RENAMED_CAROUSEL_TEMPLATE_IDS);
    if (templateId !== row.templateId) await ctx.db.patch(row._id, { templateId });
  },
});

export const renameCarouselTemplateIdInSchedules = migrations.define({
  table: "schedules",
  migrateOne: async (ctx, row) => {
    const templateId = renamedTemplateId(row.templateId, RENAMED_CAROUSEL_TEMPLATE_IDS);
    if (templateId !== row.templateId) await ctx.db.patch(row._id, { templateId });
  },
});

export const renameCarouselTemplateIdInSources = migrations.define({
  table: "sources",
  migrateOne: async (ctx, row) => {
    const templateId = renamedTemplateId(row.templateId, RENAMED_CAROUSEL_TEMPLATE_IDS);
    if (templateId !== row.templateId) await ctx.db.patch(row._id, { templateId });
  },
});

export const renameCarouselTemplateIdInRuns = migrations.define({
  table: "runs",
  migrateOne: async (ctx, row) => {
    const templateId = renamedTemplateId(row.templateId, RENAMED_CAROUSEL_TEMPLATE_IDS);
    if (templateId !== row.templateId) await ctx.db.patch(row._id, { templateId });
  },
});

const PENDING_MIGRATIONS: MigrationFunctionReference[] = [
  internal.migrations.deleteEnrichObservationsMissions,
  internal.migrations.cleanEnrichObservationsSchedules,
  internal.migrations.migrateLegacySourceMissionReferences,
  internal.migrations.deleteLegacySourceMissions,
  internal.migrations.renameTemplateIdsInProjectAgents,
  internal.migrations.renameTemplateIdsInMissions,
  internal.migrations.renameTemplateIdsInJobs,
  internal.migrations.renameTemplateIdsInSchedules,
  internal.migrations.renameTemplateIdsInSources,
  internal.migrations.renameTemplateIdsInRuns,
  internal.migrations.renameCarouselTemplateIdInProjectAgents,
  internal.migrations.renameCarouselTemplateIdInMissions,
  internal.migrations.renameCarouselTemplateIdInJobs,
  internal.migrations.renameCarouselTemplateIdInSchedules,
  internal.migrations.renameCarouselTemplateIdInSources,
  internal.migrations.renameCarouselTemplateIdInRuns,
];

// `migrations.runSerially` (mutation-only) just schedules batches to run
// asynchronously via the Convex scheduler — it returns as soon as the first
// batch is enqueued, not once every migration has finished. The bootstrap
// script needs `npx convex run migrations:runAll` to only exit once
// migrations are actually done, so the rest of the stack never starts
// against a partially migrated schema. `runToCompletion` (action-only) polls
// each migration's own batches to a terminal state before returning, so we
// run the pending list sequentially through it instead.
export const runAll = internalAction({
  args: {},
  handler: async (ctx) => {
    for (const migration of PENDING_MIGRATIONS) {
      await runToCompletion(ctx, components.migrations, migration);
    }
    await ctx.runAction(internal.migrations.cleanupLegacyWorkspaceArtifacts, {});
    return null;
  },
});

// Never add this to PENDING_MIGRATIONS — it exists solely so
// test/migrations.test.ts can prove the developer-authored-migration path
// (issue #267's acceptance criteria) actually runs to completion end to end,
// the same way a real migration appended to the list above would.
export const exampleMigrationForTests = migrations.define({
  table: "missions",
  migrateOne: async (ctx, mission) => {
    if (mission.name === undefined) {
      await ctx.db.patch(mission._id, { name: "untitled" });
    }
  },
});
