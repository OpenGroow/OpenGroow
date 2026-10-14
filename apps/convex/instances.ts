import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server.js";
import { isOptionalPluginEnabled } from "./optional_plugins.js";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import type { Doc } from "./_generated/dataModel.js";
import { instanceJobStatusV, runtimeStatusV } from "./validators.js";
import {
  insertProject,
  ownerOfInstance,
  projectOfInstance,
  setProjectDisplayName,
  withOwner,
} from "./projects.js";

type ProviderEntry = NonNullable<Doc<"instances">["providers"]>[number];

export const saveJob = internalMutation({
  args: {
    userId: v.optional(v.string()),
    job: v.object({
      id: v.string(),
      status: instanceJobStatusV,
      runtimeStatus: runtimeStatusV,
      runtimeReady: v.optional(v.boolean()),
      runtimeStatusUpdatedAt: v.optional(v.string()),
      runtimeStatusError: v.optional(v.string()),
      createdAt: v.string(),
      startedAt: v.optional(v.string()),
      finishedAt: v.optional(v.string()),
      error: v.optional(v.string()),
      network: v.optional(
        v.object({
          id: v.number(),
          name: v.string(),
          ipRange: v.string()
        })
      ),
      broker: v.optional(
        v.object({
          serverId: v.number(),
          name: v.string(),
          ipv4: v.optional(v.string()),
          privateIp: v.optional(v.string())
        })
      ),
      openclaw: v.optional(
        v.object({
          serverId: v.number(),
          name: v.string(),
          ipv4: v.optional(v.string()),
          privateIp: v.optional(v.string()),
          openClawId: v.string(),
          openClawKeyId: v.string(),
          gatewayToken: v.optional(v.string())
        })
      )
    }),
    status: v.number()
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("instances")
      .withIndex("by_job_id", (q) => q.eq("jobId", args.job.id))
      .first();
    const now = new Date().toISOString();

    const runtimeStatus = args.job.runtimeStatus;
    const runtimeReady =
      args.job.runtimeReady ??
      existing?.runtimeReady ??
      (runtimeStatus === "created" || runtimeStatus === "linked");
    const runtimeStatusUpdatedAt =
      args.job.runtimeStatusUpdatedAt ??
      existing?.runtimeStatusUpdatedAt ??
      now;
    const runtimeStatusError =
      args.job.runtimeStatusError !== undefined
        ? args.job.runtimeStatusError
        : runtimeStatus === "created" || runtimeStatus === "linked"
          ? undefined
          : existing?.runtimeStatusError;

    const payload = {
      jobId: args.job.id,
      status: args.job.status,
      runtimeStatus,
      runtimeReady,
      runtimeStatusUpdatedAt,
      runtimeStatusError,
      error: args.job.error,
      createdAt: args.job.createdAt,
      startedAt: args.job.startedAt,
      finishedAt: args.job.finishedAt,
      networkId: args.job.network?.id ?? existing?.networkId,
      networkName: args.job.network?.name ?? existing?.networkName,
      brokerServerId: args.job.broker?.serverId ?? existing?.brokerServerId,
      brokerPrivateIp: args.job.broker?.privateIp ?? existing?.brokerPrivateIp,
      openclawServerId: args.job.openclaw?.serverId ?? existing?.openclawServerId,
      openclawName: args.job.openclaw?.name ?? existing?.openclawName,
      openclawKeyId: args.job.openclaw?.openClawKeyId ?? existing?.openclawKeyId,
      openclawId: args.job.openclaw?.openClawId ?? existing?.openclawId,
      openclawGatewayToken:
        args.job.openclaw?.gatewayToken ?? existing?.openclawGatewayToken,
      openclawVersion: existing?.openclawVersion,
      openclawVersionUpdatedAt: existing?.openclawVersionUpdatedAt,
      ipv4: args.job.openclaw?.ipv4 ?? existing?.ipv4,
      updatedAt: now
    };

    let id;
    if (existing) {
      id = existing._id;
      await ctx.db.patch(existing._id, payload);
      // The Project identifier is set once, when the OpenClaw id first
      // appears, and never moves afterwards (re-provisioning included).
      const project = await ctx.db.get(existing.projectId);
      if (project) {
        const sync: { projectId?: string; ownerId?: string } = {};
        if (!project.projectId && payload.openclawId) sync.projectId = payload.openclawId;
        if (args.userId && project.ownerId !== args.userId) sync.ownerId = args.userId;
        if (Object.keys(sync).length > 0) await ctx.db.patch(project._id, { ...sync, updatedAt: Date.now() });
      }
    } else {
      // The Project exists from the first moment, before any OpenClaw id.
      const projectDocId = await insertProject(ctx, {
        projectId: payload.openclawId,
        ownerId: args.userId,
      });
      id = await ctx.db.insert("instances", { ...payload, projectId: projectDocId });
    }
    // The Project exists (it has its id) from the first time the job carries
    // the OpenClaw id: install the Source Template (#673), after the commit.
    if (payload.openclawId && !existing?.openclawId) {
      await ctx.scheduler.runAfter(0, internal.source_bootstrap_node.bootstrap, { projectId: payload.openclawId });
    }
    if (
      runtimeStatus === "created" &&
      existing?.runtimeStatus !== "created" &&
      existing?.runtimeStatus !== "linked"
    ) {
      await ctx.scheduler.runAfter(0, internal.instances_node.verifyRuntimeLinkForJob, {
        jobId: args.job.id,
        attempt: 0
      });
    }
    return id;
  }
});

// OSS self-host, local-multi (issue #306): records a row for an instance
// already provisioned by the local control-plane (apps/openclaw-local-control,
// issue #305) — the id and per-instance credentials are supplied by the
// caller (instance_provisioning/local.ts, after its HTTP call to that
// service succeeds), not generated here. No existing-row check: each call to
// the local control-plane provisions its own isolated Docker Compose
// project, so any number of rows is expected.
// Issue #308: self-host runs exactly one shared broker container (not one
// per instance — the "broker" InstanceLogTarget only ever means this
// container), so every local instance points at the same sentinel value.
// It only needs to be a number: the dashboard's logs-panel.tsx gates
// showing the broker controls on `typeof instance.brokerServerId ===
// "number"`, and never uses its value to pick which instance to target.
const LOCAL_BROKER_SERVER_ID = 0;

export const createLocalInstance = internalMutation({
  args: {
    nameSuffix: v.optional(v.string()),
    userId: v.string(),
    // Issued by the local control-plane's POST /instances (issue #305) —
    // matches the existing `local-<uuid>` job-id convention. Used as both
    // jobId and openclawId: it's also the OPENCLAW_INSTANCE_ID the compose
    // project is started with, which is what runtime-link verification and
    // command dispatch route commands to over the broker.
    jobId: v.string(),
    // Also issued by POST /instances (the compose project's allocated
    // gateway host port). Doubles as this instance's `openclawServerId`
    // (issue #308): the local control-plane has no VM/serverId of its own,
    // and the dashboard's logs/status panels address instances by
    // `serverId`, unmodified — the port is the one value the control-plane
    // already guarantees is unique per instance, so it's reused as that key
    // (see instance_provisioning/local.ts's logs/status).
    port: v.number(),
    openclawKeyId: v.string(),
    openclawGatewayToken: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const jobId = args.jobId;
    const openclawId = jobId;
    const openclawName = args.nameSuffix?.trim()
      ? `openclaw-${args.nameSuffix.trim()}`
      : `openclaw-${jobId}`;

    // No runtime-link verification here, unlike the remote control-plane's job flow: there's
    // no VM to boot and no broker round-trip to wait on, since the
    // compose-managed openclaw-gateway container is already running by the
    // time this mutation runs (openclaw-local-control's `docker compose up`
    // already completed before this call). Marking it "linked" immediately
    // avoids a needless health-check dispatch (issue: self-host Project
    // stuck "Still Starting"). See ADR-033 (docs/adr/033-local-multi-is-the-only-self-host-provisioning-model.md).
    const projectDocId = await insertProject(ctx, { projectId: openclawId, ownerId: args.userId });
    await ctx.db.insert("instances", {
      projectId: projectDocId,
      jobId,
      status: "succeeded",
      error: undefined,
      createdAt: now,
      startedAt: now,
      finishedAt: now,
      openclawServerId: args.port,
      brokerServerId: LOCAL_BROKER_SERVER_ID,
      openclawName,
      openclawId,
      openclawKeyId: args.openclawKeyId,
      openclawGatewayToken: args.openclawGatewayToken,
      runtimeStatus: "linked",
      runtimeReady: true,
      runtimeStatusUpdatedAt: now,
      updatedAt: now
    });

    // Install the Source Template from the hub once the Project exists (#673).
    // Scheduled, so an unreachable hub never blocks the creation.
    await ctx.scheduler.runAfter(0, internal.source_bootstrap_node.bootstrap, { projectId: openclawId });

    return {
      status: 200,
      job: {
        id: jobId,
        status: "succeeded" as const,
        runtimeStatus: "linked" as const,
        runtimeReady: true,
        runtimeStatusUpdatedAt: now,
        createdAt: now,
        startedAt: now,
        finishedAt: now,
        openclaw: {
          serverId: args.port,
          name: openclawName,
          openClawId: openclawId,
          openClawKeyId: args.openclawKeyId,
          gatewayToken: args.openclawGatewayToken
        }
      }
    };
  }
});

// Cosmetic label, editable any time regardless of provisioning status or
// backend (remote control-plane or local self-host) — decoupled from openclawName, which
// still drives the remote server and peer names for control-plane Instances (see
// instances_node.ts's removeInstance). Renaming here never touches infra.
const MAX_DISPLAY_NAME_LENGTH = 60;

export const renameInstance = mutation({
  args: {
    jobId: v.string(),
    displayName: v.string()
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    const displayName = args.displayName.trim();
    if (!displayName) {
      throw new Error("Project name cannot be empty");
    }
    if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
      throw new Error(`Project name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer`);
    }

    const row = await ctx.db
      .query("instances")
      .withIndex("by_job_id", (q) => q.eq("jobId", args.jobId))
      .first();
    if (!row) {
      throw new Error("Project not found");
    }
    const project = await projectOfInstance(ctx, row);
    const ownerId = project?.ownerId;
    if (ownerId && ownerId !== identity.tokenIdentifier && ownerId !== identity.subject) {
      throw new Error("Forbidden");
    }

    await setProjectDisplayName(ctx, row.projectId, displayName);
    return { ok: true };
  }
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAuthenticatedUser(ctx);
    const rows = await ctx.db.query("instances").order("desc").take(100);
    // The Project is the source of the name.
    return await Promise.all(
      rows.map(async (row) => ({
        ...row,
        displayName: (await projectOfInstance(ctx, row))?.displayName,
      })),
    );
  }
});

export const getByJobId = internalQuery({
  args: { jobId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("instances")
      .withIndex("by_job_id", (q) => q.eq("jobId", args.jobId))
      .first();
    return row ? await withOwner(ctx, row) : null;
  }
});

export const getRuntimeLinkTargetByJobId = internalQuery({
  args: { jobId: v.string() },
  handler: async (ctx, args) => {
    const jobId = args.jobId.trim();
    if (!jobId) {
      return null;
    }
    const row = await ctx.db
      .query("instances")
      .withIndex("by_job_id", (q) => q.eq("jobId", jobId))
      .first();
    if (!row) {
      return null;
    }
    return {
      jobId: row.jobId,
      openclawId: row.openclawId,
      runtimeStatus: row.runtimeStatus
    };
  }
});

export const getUniqueByOpenclawId = internalQuery({
  args: { openclawId: v.string() },
  handler: async (ctx, args) => {
    const openclawId = args.openclawId.trim();
    if (!openclawId) {
      return null;
    }
    const rows = await ctx.db
      .query("instances")
      .withIndex("by_openclaw_id", (q) => q.eq("openclawId", openclawId))
      .take(2);
    return rows.length === 1 ? await withOwner(ctx, rows[0]) : null;
  }
});

const providerKindV = v.union(v.literal("subscription"), v.literal("apikey"));

// Marks the (provider, kind) entry as the one in use, replacing whichever
// entry(ies) previously held that flag. Shared by every write path that
// establishes a new "this is now the active Provider" fact: a fresh
// OAuth link, a fresh manual config save, and a same-entry reactivation
// (see setProviderActiveByOpenclawId).
//
// Keeps the entry at its existing array index (or appends if it's new)
// rather than filter-then-append — the dashboard table renders providers
// in array order, so moving the entry to the end on every activation made
// rows jump around each time the user switched providers (confusing: see
// providers-page-content.tsx).
function withProviderInUse(
  existing: ProviderEntry[],
  next: Omit<ProviderEntry, "inUse">
): ProviderEntry[] {
  const matchIndex = existing.findIndex(
    (entry) => entry.provider === next.provider && entry.kind === next.kind
  );
  const cleared = existing.map((entry) => ({ ...entry, inUse: false }));
  if (matchIndex === -1) {
    return [...cleared, { ...next, inUse: true }];
  }
  cleared[matchIndex] = { ...next, inUse: true };
  return cleared;
}

// Upserts a Provider entry from a successful link/config result (OAuth
// completion or manual api-key save) and makes it the one in use. Replaces
// the earlier separate setAuthProviderStateByOpenclawId/
// setAiConfigStateByOpenclawId mutations (#280) — those tracked "linked" and
// "configured" independently per auth kind and could disagree about which
// Provider the agent actually called.
export const upsertProviderByOpenclawId = internalMutation({
  args: {
    openclawId: v.string(),
    kind: providerKindV,
    provider: v.string(),
    model: v.string(),
    baseUrl: v.optional(v.string()),
    updatedAt: v.string()
  },
  handler: async (ctx, args) => {
    const openclawId = args.openclawId.trim();
    if (!openclawId) {
      return { updated: 0 };
    }

    const rows = await ctx.db
      .query("instances")
      .withIndex("by_openclaw_id", (q) => q.eq("openclawId", openclawId))
      .collect();

    const provider = args.provider.trim();
    const model = args.model.trim();
    const baseUrl = args.baseUrl?.trim() || undefined;

    for (const row of rows) {
      await ctx.db.patch(row._id, {
        providers: withProviderInUse(row.providers ?? [], {
          kind: args.kind,
          provider,
          model,
          baseUrl,
          updatedAt: args.updatedAt
        })
      });
    }

    return { updated: rows.length };
  }
});

// Switches which already-configured Provider is in use, without touching
// its stored model/baseUrl — used after a no-reauth reactivation (or a
// resubmitted api-key config) confirms agents.defaults.model.primary was
// updated on the runtime side. Never creates a new entry: activating a
// Provider that isn't in `providers` yet is a no-op (the caller must
// upsert it first).
export const setProviderActiveByOpenclawId = internalMutation({
  args: {
    openclawId: v.string(),
    kind: providerKindV,
    provider: v.string(),
    updatedAt: v.string()
  },
  handler: async (ctx, args) => {
    const openclawId = args.openclawId.trim();
    if (!openclawId) {
      return { updated: 0 };
    }

    const provider = args.provider.trim();

    const rows = await ctx.db
      .query("instances")
      .withIndex("by_openclaw_id", (q) => q.eq("openclawId", openclawId))
      .collect();

    let updated = 0;
    for (const row of rows) {
      const existing = row.providers ?? [];
      const match = existing.find((entry) => entry.provider === provider && entry.kind === args.kind);
      if (!match) {
        continue;
      }
      await ctx.db.patch(row._id, {
        providers: withProviderInUse(existing, {
          kind: match.kind,
          provider: match.provider,
          model: match.model,
          baseUrl: match.baseUrl,
          updatedAt: args.updatedAt
        })
      });
      updated += 1;
    }

    return { updated };
  }
});

export const removeProvider = mutation({
  args: {
    instanceId: v.id("instances"),
    kind: providerKindV,
    provider: v.string()
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");
    const row = await ctx.db.get(args.instanceId);
    if (!row) return { ok: false };
    const ownerId = await ownerOfInstance(ctx, row);
    if (ownerId && ownerId !== identity.tokenIdentifier && ownerId !== identity.subject) {
      throw new Error("Forbidden");
    }
    const existing = row.providers ?? [];
    const match = existing.find((entry) => entry.provider === args.provider && entry.kind === args.kind);
    if (match?.inUse) {
      return {
        ok: false,
        error: "This provider is in use. Activate another provider first."
      };
    }
    const updated = existing.filter(
      (entry) => !(entry.provider === args.provider && entry.kind === args.kind)
    );
    await ctx.db.patch(args.instanceId, { providers: updated });
    return { ok: true };
  }
});

export const setWhatsAppChannelStateByOpenclawId = internalMutation({
  args: {
    openclawId: v.string(),
    linked: v.boolean(),
    connected: v.boolean(),
    phoneNumber: v.optional(v.string()),
    configSyncedAt: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
    updatedAt: v.string()
  },
  handler: async (ctx, args) => {
    const openclawId = args.openclawId.trim();
    if (!openclawId) {
      return { updated: 0 };
    }

    const rows = await ctx.db
      .query("instances")
      .withIndex("by_openclaw_id", (q) => q.eq("openclawId", openclawId))
      .collect();

    for (const row of rows) {
      const previous = row.whatsAppChannel;
      await ctx.db.patch(row._id, {
        whatsAppChannel: {
          linked: args.linked,
          connected: args.connected,
          phoneNumber: args.phoneNumber?.trim() || previous?.phoneNumber,
          configSyncedAt: args.configSyncedAt ?? previous?.configSyncedAt,
          enabled: args.enabled ?? previous?.enabled,
          updatedAt: args.updatedAt
        }
      });
    }

    return { updated: rows.length };
  }
});

// Issue #493: a WhatsApp channel stuck "configured but never linked" made
// OpenClaw retry every ~30-40s, each retry re-running a full LLM agent turn
// (946.9M tokens burned in a day). This is the threshold at which the
// watchdog (instances_node.runWhatsAppLinkWatchdogTick) gives up on a
// channel and flips it off automatically rather than letting it retry
// forever.
export const WHATSAPP_LINK_FAILURE_THRESHOLD = 3;

export const recordWhatsAppLinkProbeResult = internalMutation({
  args: {
    openclawId: v.string(),
    linked: v.boolean(),
    connected: v.boolean(),
    updatedAt: v.string()
  },
  handler: async (ctx, args) => {
    const openclawId = args.openclawId.trim();
    if (!openclawId) {
      return { updated: 0, linkFailureCount: 0, shouldAutoDisable: false };
    }

    const rows = await ctx.db
      .query("instances")
      .withIndex("by_openclaw_id", (q) => q.eq("openclawId", openclawId))
      .collect();

    let linkFailureCount = 0;
    let shouldAutoDisable = false;

    for (const row of rows) {
      const previous = row.whatsAppChannel;
      linkFailureCount = args.linked ? 0 : (previous?.linkFailureCount ?? 0) + 1;
      shouldAutoDisable = linkFailureCount >= WHATSAPP_LINK_FAILURE_THRESHOLD;
      await ctx.db.patch(row._id, {
        whatsAppChannel: {
          linked: args.linked,
          connected: args.connected,
          phoneNumber: previous?.phoneNumber,
          configSyncedAt: previous?.configSyncedAt,
          enabled: shouldAutoDisable ? false : previous?.enabled,
          linkFailureCount,
          autoDisabledReason: args.linked
            ? undefined
            : shouldAutoDisable
              ? `Auto-disabled after ${linkFailureCount} consecutive failed link checks`
              : previous?.autoDisabledReason,
          updatedAt: args.updatedAt
        }
      });
    }

    return { updated: rows.length, linkFailureCount, shouldAutoDisable };
  }
});

export const listWhatsAppLinkWatchdogCandidates = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Without the plugin every probe fails: the watchdog would count those as
    // failed links and auto-disable channels that are merely unavailable.
    if (!isOptionalPluginEnabled("whatsapp")) return [];
    const rows = await ctx.db
      .query("instances")
      .withIndex("by_whatsapp_channel_linked", (q) => q.eq("whatsAppChannel.linked", false))
      .collect();
    return rows
      .filter((row) => {
        const channel = row.whatsAppChannel;
        return !!row.openclawId && !!channel?.phoneNumber?.trim() && channel.enabled !== false;
      })
      .map((row) => ({
        openclawId: row.openclawId as string,
        linkFailureCount: row.whatsAppChannel?.linkFailureCount ?? 0
      }));
  }
});

export const setTelegramChannelStateByOpenclawId = internalMutation({
  args: {
    openclawId: v.string(),
    configured: v.boolean(),
    updatedAt: v.string()
  },
  handler: async (ctx, args) => {
    const openclawId = args.openclawId.trim();
    if (!openclawId) {
      return { updated: 0 };
    }

    const rows = await ctx.db
      .query("instances")
      .withIndex("by_openclaw_id", (q) => q.eq("openclawId", openclawId))
      .collect();

    for (const row of rows) {
      await ctx.db.patch(row._id, {
        telegramChannel: {
          configured: args.configured,
          updatedAt: args.updatedAt
        }
      });
    }

    return { updated: rows.length };
  }
});

export const setSpeechToTextStateByOpenclawId = internalMutation({
  args: {
    openclawId: v.string(),
    provider: v.string(),
    enabled: v.boolean(),
    updatedAt: v.string()
  },
  handler: async (ctx, args) => {
    const openclawId = args.openclawId.trim();
    if (!openclawId) {
      return { updated: 0 };
    }

    const rows = await ctx.db
      .query("instances")
      .withIndex("by_openclaw_id", (q) => q.eq("openclawId", openclawId))
      .collect();

    for (const row of rows) {
      await ctx.db.patch(row._id, {
        speechToText: {
          provider: args.provider.trim(),
          enabled: args.enabled,
          updatedAt: args.updatedAt
        }
      });
    }

    return { updated: rows.length };
  }
});

export const setOpenClawVersionByOpenclawId = internalMutation({
  args: {
    openclawId: v.string(),
    version: v.string(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const openclawId = args.openclawId.trim();
    const version = args.version.trim();
    if (!openclawId || !version) {
      return { updated: 0 };
    }

    const rows = await ctx.db
      .query("instances")
      .withIndex("by_openclaw_id", (q) => q.eq("openclawId", openclawId))
      .collect();

    for (const row of rows) {
      await ctx.db.patch(row._id, {
        openclawVersion: version,
        openclawVersionUpdatedAt: args.updatedAt,
        updatedAt: args.updatedAt,
      });
    }

    return { updated: rows.length };
  },
});

export const setWorkspaceListByOpenclawId = internalMutation({
  args: {
    openclawId: v.string(),
    workspaces: v.array(
      v.object({
        workspaceKey: v.string(),
        label: v.string(),
        absolutePath: v.string(),
        isActive: v.boolean(),
        kind: v.string(),
        availableFiles: v.array(
          v.object({
            filePath: v.string(),
            title: v.string(),
            kind: v.string(),
          })
        ),
      })
    ),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const openclawId = args.openclawId.trim();
    if (!openclawId) {
      return { updated: 0 };
    }
    const row = await ctx.db
      .query("instances")
      .withIndex("by_openclaw_id", (q) => q.eq("openclawId", openclawId))
      .unique();
    if (!row) {
      return { updated: 0 };
    }
    await ctx.db.patch(row._id, {
      workspaceList: { workspaces: args.workspaces, updatedAt: args.updatedAt },
      updatedAt: args.updatedAt,
    });
    return { updated: 1 };
  },
});

export const setRuntimeStateByJobId = internalMutation({
  args: {
    jobId: v.string(),
    runtimeStatus: runtimeStatusV,
    runtimeReady: v.boolean(),
    runtimeStatusUpdatedAt: v.string(),
    runtimeStatusError: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const jobId = args.jobId.trim();
    if (!jobId) {
      return { updated: 0 };
    }

    const row = await ctx.db
      .query("instances")
      .withIndex("by_job_id", (q) => q.eq("jobId", jobId))
      .first();
    if (!row) {
      return { updated: 0 };
    }

    await ctx.db.patch(row._id, {
      runtimeStatus: args.runtimeStatus,
      runtimeReady: args.runtimeReady,
      runtimeStatusUpdatedAt: args.runtimeStatusUpdatedAt,
      runtimeStatusError: args.runtimeStatusError,
      updatedAt: args.runtimeStatusUpdatedAt
    });
    return { updated: 1 };
  }
});

export const setRuntimeStateByOpenclawId = internalMutation({
  args: {
    openclawId: v.string(),
    runtimeStatus: runtimeStatusV,
    runtimeReady: v.boolean(),
    runtimeStatusUpdatedAt: v.string(),
    runtimeStatusError: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const openclawId = args.openclawId.trim();
    if (!openclawId) {
      return { updated: 0 };
    }

    const rows = await ctx.db
      .query("instances")
      .withIndex("by_openclaw_id", (q) => q.eq("openclawId", openclawId))
      .collect();

    for (const row of rows) {
      await ctx.db.patch(row._id, {
        runtimeStatus: args.runtimeStatus,
        runtimeReady: args.runtimeReady,
        runtimeStatusUpdatedAt: args.runtimeStatusUpdatedAt,
        runtimeStatusError: args.runtimeStatusError,
        updatedAt: args.runtimeStatusUpdatedAt
      });
    }

    return { updated: rows.length };
  }
});

export const deleteByJobId = internalMutation({
  args: { jobId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("instances")
      .withIndex("by_job_id", (q) => q.eq("jobId", args.jobId))
      .collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
      // The Project goes with its last Instance, never while another row runs it.
      if (row.projectId) {
        const projectId = row.projectId;
        const other = await ctx.db
          .query("instances")
          .withIndex("by_project", (q) => q.eq("projectId", projectId))
          .first();
        if (!other) await ctx.db.delete(projectId);
      }
    }
    return { deleted: rows.length };
  }
});

async function requireAuthenticatedUser(ctx: QueryCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Authentication required");
  }
  return identity.tokenIdentifier;
}
