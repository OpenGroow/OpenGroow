"use node";

import { action, internalAction, type ActionCtx } from "./_generated/server.js";
import { v } from "convex/values";
import { api, internal } from "./_generated/api.js";
import type { FunctionReference } from "convex/server";
import {
  RUNTIME_HEALTH_CHECK,
  RUNTIME_WHATSAPP_CONFIG_SET,
  RUNTIME_WHATSAPP_PAIR_WAIT,
  RUNTIME_OPENCLAW_EXEC,
} from "@opengroow/protocol";
import { parseOpenClawUsageOutput } from "./openclaw_usage";
import { env } from "./env";
import {
  waitForRuntimeEvent,
  parseRuntimeHealthPayload,
  enqueueCommandMutation,
  enqueueInteractiveCommand,
  refreshOpenClawVersionForInstance,
} from "./runtime_commands_node";
import {
  parseRuntimeOpenClawExecPayload,
  parseRuntimeWhatsAppPairPayload,
} from "./runtime_commands_node_parsers";
import { readRuntimeResult } from "./project_channel_operations";
import { instanceProvisioner } from "./instance_provisioning/index.js";
import type {
  InstanceJobPayload,
  RemoveInstanceResult,
} from "./instance_provisioning/types.js";

type StoredInstance = {
  ownerId?: string;
  openclawServerId?: number;
  openclawName?: string;
};

type RuntimeLinkTarget = {
  jobId: string;
  openclawId?: string;
  runtimeStatus?: string;
};

type RuntimeLinkVerificationResult = {
  runtimeStatus: string;
  runtimeReady: boolean;
  runtimeStatusUpdatedAt: string;
  runtimeStatusError?: string;
};

const getInstanceByJobIdQuery = internal.instances
  .getByJobId as unknown as FunctionReference<
  "query",
  "internal",
  { jobId: string },
  StoredInstance | null
>;

const RUNTIME_LINK_MAX_ATTEMPTS = 5;
const RUNTIME_LINK_RETRY_DELAYS_MS = [10_000, 20_000, 40_000, 80_000, 160_000] as const;
const OPENCLAW_VERSION_REFRESH_AFTER_ROLLOUT_DELAY_MS = 120_000;

type AuthenticatedUser = {
  tokenIdentifier: string;
  subject: string;
};

async function requireAuthenticatedUser(ctx: ActionCtx): Promise<AuthenticatedUser> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Authentication required");
  }
  return {
    tokenIdentifier: identity.tokenIdentifier,
    subject: identity.subject,
  };
}

function canAccessInstance(instance: StoredInstance, user: AuthenticatedUser): boolean {
  return (
    !instance.ownerId ||
    instance.ownerId === user.tokenIdentifier ||
    instance.ownerId === user.subject
  );
}

export const createJob = action({
  args: {
    nameSuffix: v.optional(v.string()),
    openClawImageRef: v.optional(v.string()),
    // User-facing label typed in the "New Project" dialog — stored
    // separately from nameSuffix/openclawName (see instances.ts's
    // renameInstance), so it never affects the remote server name and peer
    // name derivation.
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    const data = await instanceProvisioner.createInstance(ctx, {
      nameSuffix: args.nameSuffix,
      openClawImageRef: args.openClawImageRef,
      userId: user.tokenIdentifier,
    });

    if (data.job) {
      const sanitizedJob = sanitizeJob(data.job);
      await ctx.runMutation(internal.instances.saveJob, {
        job: sanitizedJob,
        status: data.status ?? 200,
        userId: user.tokenIdentifier,
      });

      const displayName = args.displayName?.trim();
      if (displayName) {
        await ctx.runMutation(api.instances.renameInstance, {
          jobId: sanitizedJob.id,
          displayName,
        });
      }
    }

    return data;
  },
});

export const refreshJob = action({
  args: { jobId: v.string() },
  handler: async (ctx, args) => {
    await requireAuthenticatedUser(ctx);
    const data = await instanceProvisioner.list(ctx, { jobId: args.jobId });

    if (data.job) {
      const sanitizedJob = sanitizeJob(data.job);
      await ctx.runMutation(internal.instances.saveJob, {
        job: sanitizedJob,
        status: data.status ?? 200,
      });
    } else if (data.error && /server not found/i.test(data.error)) {
      await ctx.runMutation(internal.instances.deleteByJobId, { jobId: args.jobId });
    }
    return data;
  },
});

export const verifyRuntimeLinkForJob = internalAction({
  args: { jobId: v.string(), attempt: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<
    | RuntimeLinkVerificationResult
    | { status: 404; error: string }
    | { status: 200; skipped: true }
  > => {
    const target: RuntimeLinkTarget | null = await ctx.runQuery(
      internal.instances.getRuntimeLinkTargetByJobId,
      { jobId: args.jobId },
    );
    if (!target) {
      return { status: 404, error: "Project not found" };
    }
    return (await verifyRuntimeLinkIfNeeded(ctx, target, args.attempt ?? 0)) ?? {
      status: 200,
      skipped: true,
    };
  },
});

export const removeInstance = action({
  args: { jobId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { status: 200; ok: true; deleted: number; serverDeleted: boolean }
    | { status: number; error: string }
  > => {
    const jobId = args.jobId.trim();
    if (!jobId) {
      return { status: 400, error: "jobId is required" };
    }

    const instance = await ctx.runQuery(getInstanceByJobIdQuery, { jobId });
    if (!instance) {
      return { status: 404, error: "Project not found" };
    }
    const user = await requireAuthenticatedUser(ctx);
    if (!canAccessInstance(instance, user)) {
      return { status: 403, error: "Forbidden" };
    }

    const serverId: number | undefined = instance.openclawServerId;
    const serverName = instance.openclawName ?? buildOpenClawNameFromJobId(jobId);
    const controlDelete = await instanceProvisioner.removeInstance(ctx, {
      jobId,
      serverId,
      serverName,
      peerName: serverName,
    });
    const deleteFailure = describeDeleteFailure(controlDelete);
    if (deleteFailure) {
      return { status: controlDelete.status ?? 200, error: deleteFailure };
    }

    const deleted: { deleted: number } = await ctx.runMutation(
      internal.instances.deleteByJobId,
      {
        jobId,
      },
    );
    return {
      status: 200,
      ok: true,
      deleted: deleted.deleted,
      serverDeleted: controlDelete.serverDeleted === true,
    };
  },
});

export const destroyAllInstances = action({
  args: {},
  handler: async (ctx) => {
    await requireAuthenticatedUser(ctx);
    const instances = await ctx.runQuery(api.instances.list, {});
    const results: Array<{ jobId: string; ok: boolean; error?: string }> = [];
    let destroyed = 0;

    for (const instance of instances as Array<{
      jobId: string;
      openclawServerId?: number;
      openclawName?: string;
    }>) {
      const jobId =
        typeof instance.jobId === "string" ? instance.jobId.trim() : "";
      if (!jobId) {
        results.push({ jobId: "", ok: false, error: "Missing jobId" });
        continue;
      }

      const serverId = instance.openclawServerId;
      const serverName =
        instance.openclawName ?? buildOpenClawNameFromJobId(jobId);
      const controlDelete = await instanceProvisioner.removeInstance(ctx, {
        jobId,
        serverId,
        serverName,
        peerName: serverName,
      });
      const deleteFailure = describeDeleteFailure(controlDelete);
      if (deleteFailure) {
        results.push({ jobId, ok: false, error: deleteFailure });
        continue;
      }

      await ctx.runMutation(internal.instances.deleteByJobId, { jobId });
      destroyed += 1;
      results.push({ jobId, ok: true });
    }

    return {
      status: 200,
      ok: results.every((item) => item.ok),
      attempted: results.length,
      destroyed,
      failed: results.filter((item) => !item.ok).length,
      results,
    };
  },
});

export const rollout = action({
  args: {
    openClawImageRef: v.optional(v.string()),
    concurrency: v.optional(v.number()),
    refreshCompose: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAuthenticatedUser(ctx);
    const instances = await ctx.runQuery(api.instances.list, {});
    const ips = instances
      .map((item: { ipv4?: string }) => item.ipv4)
      .filter((value: string | undefined): value is string => !!value);
    const openclawIds = instances
      .map((item: { openclawId?: string }) => item.openclawId?.trim())
      .filter((value): value is string => !!value);

    const data = await instanceProvisioner.rollout(ctx, {
      ips,
      openClawImageRef: args.openClawImageRef?.trim() || undefined,
      concurrency: args.concurrency,
      refreshCompose: args.refreshCompose,
    });

    if ((data.status ?? 200) < 400 && !data.error && openclawIds.length > 0) {
      await ctx.scheduler.runAfter(
        OPENCLAW_VERSION_REFRESH_AFTER_ROLLOUT_DELAY_MS,
        internal.instances_node.refreshOpenClawVersionsAfterRollout,
        { openclawIds },
      );
    }

    return data;
  },
});

export const refreshOpenClawVersionsAfterRollout = internalAction({
  args: { openclawIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const instanceIds = args.openclawIds.map((id) => id.trim()).filter(Boolean);

    const results = await Promise.all(
      instanceIds.map(async (instanceId) => {
        const refreshed = await refreshOpenClawVersionForInstance(ctx, instanceId, {
          attempts: 3,
          retryDelayMs: 10_000,
          timeoutMs: 30_000,
        });
        return { instanceId, ok: refreshed.ok, error: refreshed.error };
      }),
    );

    return { ok: results.every((item) => item.ok), results };
  },
});

export const syncWhatsAppConfigAfterLink = internalAction({
  args: { openclawId: v.string() },
  handler: async (ctx, args): Promise<{ skipped: boolean } | { enqueued: boolean; phoneNumber: string }> => {
    const instance = await ctx.runQuery(
      internal.instances.getUniqueByOpenclawId,
      { openclawId: args.openclawId },
    ) as { whatsAppChannel?: { phoneNumber?: string } } | null;
    const phoneNumber = instance?.whatsAppChannel?.phoneNumber?.trim();
    if (!phoneNumber) {
      return { skipped: true };
    }
    await ctx.runMutation(enqueueCommandMutation, {
      instanceId: args.openclawId,
      type: RUNTIME_WHATSAPP_CONFIG_SET,
      payload: { phoneNumber },
    });
    return { enqueued: true, phoneNumber };
  },
});

const WHATSAPP_WATCHDOG_PROBE_TIMEOUT_MS = 5_000;

// Issue #493: catches a WhatsApp channel stuck "configured but never
// linked" (OpenClaw retried it every ~30-40s, each retry re-running a full
// LLM agent turn — 946.9M tokens burned in a day). Runs on a cron
// (crons.ts) rather than reacting to any single event, since the failure
// mode is OpenClaw retrying on its own schedule, not something OpenGroow is
// told about.
export const runWhatsAppLinkWatchdogTick = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number; autoDisabled: number }> => {
    const candidates = await ctx.runQuery(
      internal.instances.listWhatsAppLinkWatchdogCandidates,
      {},
    );

    let autoDisabled = 0;
    for (const candidate of candidates) {
      const result = await readRuntimeResult(
        ctx,
        candidate.openclawId,
        RUNTIME_WHATSAPP_PAIR_WAIT,
        { timeoutMs: WHATSAPP_WATCHDOG_PROBE_TIMEOUT_MS },
      );
      const parsed = parseRuntimeWhatsAppPairPayload(result.type, result.payload);
      const linked = parsed?.ok === true && parsed.data.linked === true;
      const connected = parsed?.ok === true && parsed.data.connected === true;

      const record = await ctx.runMutation(internal.instances.recordWhatsAppLinkProbeResult, {
        openclawId: candidate.openclawId,
        linked: linked || connected,
        connected,
        updatedAt: new Date().toISOString(),
      });

      if (record.shouldAutoDisable) {
        autoDisabled += 1;
        await ctx.runMutation(enqueueCommandMutation, {
          instanceId: candidate.openclawId,
          type: RUNTIME_WHATSAPP_CONFIG_SET,
          payload: { phoneNumber: "", enabled: false },
        });
      }
    }

    return { checked: candidates.length, autoDisabled };
  },
});

export const getOpenClawLogs = action({
  args: {
    serverId: v.optional(v.number()),
    ipv4: v.optional(v.string()),
    service: v.optional(v.string()),
    tail: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAuthenticatedUser(ctx);
    return await instanceProvisioner.logs(ctx, {
      target: "openclaw",
      serverId: args.serverId,
      ipv4: args.ipv4,
      service: args.service,
      tail: args.tail,
    });
  },
});

export const getOpenClawStatus = action({
  args: {
    serverId: v.optional(v.number()),
    ipv4: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAuthenticatedUser(ctx);
    return await instanceProvisioner.status(ctx, {
      target: "openclaw",
      serverId: args.serverId,
      ipv4: args.ipv4,
    });
  },
});

const OPENCLAW_USAGE_COMMAND_TIMEOUT_MS = 30_000;

export const getOpenClawUsage = action({
  args: {
    instanceId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAuthenticatedUser(ctx);

    const dispatch = await enqueueInteractiveCommand(ctx, {
      instanceId: args.instanceId,
      type: RUNTIME_OPENCLAW_EXEC,
      payload: {
        commandText: "openclaw status --usage --json",
        timeoutMs: OPENCLAW_USAGE_COMMAND_TIMEOUT_MS,
      },
    });

    if (!dispatch.accepted || !dispatch.commandId) {
      return { status: 502, error: "Failed to dispatch OpenClaw usage command" };
    }

    const brokerResult = await waitForRuntimeEvent(
      ctx,
      args.instanceId,
      dispatch.commandId,
      OPENCLAW_USAGE_COMMAND_TIMEOUT_MS + 30_000,
    );

    const parsed = parseRuntimeOpenClawExecPayload(brokerResult.type, brokerResult.payload);
    if (!parsed) {
      return {
        status: brokerResult.found ? 502 : 504,
        error: brokerResult.found
          ? "Unexpected OpenClaw usage result"
          : "Timed out waiting for OpenClaw usage",
      };
    }
    if (!parsed.ok) {
      return { status: 502, error: parsed.error ?? "Failed to read OpenClaw usage" };
    }

    // Raw CLI output may contain infra-specific fields (sessionKey,
    // instanceId, etc.) that must never reach the dashboard — only the
    // parsed, business-safe usage summary is returned to the client.
    const usage = parseOpenClawUsageOutput(parsed.data.output);
    return { status: 200, usage };
  },
});

export const getBrokerLogs = action({
  args: {
    serverId: v.optional(v.number()),
    ipv4: v.optional(v.string()),
    tail: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAuthenticatedUser(ctx);
    return await instanceProvisioner.logs(ctx, {
      target: "broker",
      serverId: args.serverId,
      ipv4: args.ipv4,
      tail: args.tail,
    });
  },
});

export const getBrokerStatus = action({
  args: {
    serverId: v.optional(v.number()),
    ipv4: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAuthenticatedUser(ctx);
    return await instanceProvisioner.status(ctx, {
      target: "broker",
      serverId: args.serverId,
      ipv4: args.ipv4,
    });
  },
});

async function verifyRuntimeLinkIfNeeded(
  ctx: ActionCtx,
  target: InstanceJobPayload | RuntimeLinkTarget,
  attempt = 0,
): Promise<RuntimeLinkVerificationResult | null> {
  const jobId = "id" in target ? target.id : target.jobId;
  const openclawId =
    "id" in target
      ? (target.openclaw?.openClawId?.trim() ?? "")
      : (target.openclawId?.trim() ?? "");
  const runtimeStatus = target.runtimeStatus?.trim() ?? "";

  if (!openclawId || runtimeStatus !== "created") {
    return null;
  }

  const dispatch = await ctx.runMutation(enqueueCommandMutation, {
    instanceId: openclawId,
    type: RUNTIME_HEALTH_CHECK,
    payload: {},
  });
  const brokerResult = await waitForRuntimeEvent(
    ctx,
    openclawId,
    dispatch.commandId,
    env.RUNTIME_LINK_BROKER_TIMEOUT_MS,
  );
  const updatedAt = new Date().toISOString();

  if (!brokerResult.found) {
    const runtimeStatusError =
      brokerResult.status === 500
        ? "Runtime linking failed before health result"
        : "Runtime linking timed out";
    const shouldRetry = hasRuntimeLinkAttemptsRemaining(attempt);
    await ctx.runMutation(internal.instances.setRuntimeStateByJobId, {
      jobId,
      runtimeStatus: shouldRetry ? "created" : "failed",
      runtimeReady: shouldRetry,
      runtimeStatusUpdatedAt: updatedAt,
      runtimeStatusError,
    });
    if (shouldRetry) {
      await scheduleRuntimeLinkRetry(ctx, jobId, attempt, runtimeStatusError);
    }
    return {
      runtimeStatus: shouldRetry ? "created" : "failed",
      runtimeReady: shouldRetry,
      runtimeStatusUpdatedAt: updatedAt,
      runtimeStatusError,
    };
  }

  const parsed = parseRuntimeHealthPayload(
    brokerResult.type,
    brokerResult.payload,
  );
  if (!parsed) {
    const runtimeStatusError = "Unexpected runtime health response";
    const shouldRetry = hasRuntimeLinkAttemptsRemaining(attempt);
    await ctx.runMutation(internal.instances.setRuntimeStateByJobId, {
      jobId,
      runtimeStatus: shouldRetry ? "created" : "failed",
      runtimeReady: shouldRetry,
      runtimeStatusUpdatedAt: updatedAt,
      runtimeStatusError,
    });
    if (shouldRetry) {
      await scheduleRuntimeLinkRetry(ctx, jobId, attempt, runtimeStatusError);
    }
    return {
      runtimeStatus: shouldRetry ? "created" : "failed",
      runtimeReady: shouldRetry,
      runtimeStatusUpdatedAt: updatedAt,
      runtimeStatusError,
    };
  }

  const nextRuntimeStatus = parsed.ok ? "linked" : "failed";
  const runtimeStatusError = parsed.ok
    ? undefined
    : (parsed.error ?? "Runtime linking failed");
  if (!parsed.ok && hasRuntimeLinkAttemptsRemaining(attempt)) {
    const updatedAt = new Date().toISOString();
    await ctx.runMutation(internal.instances.setRuntimeStateByJobId, {
      jobId,
      runtimeStatus: "created",
      runtimeReady: true,
      runtimeStatusUpdatedAt: updatedAt,
      runtimeStatusError,
    });
    await scheduleRuntimeLinkRetry(ctx, jobId, attempt, runtimeStatusError ?? "Runtime linking failed");
    return {
      runtimeStatus: "created",
      runtimeReady: true,
      runtimeStatusUpdatedAt: updatedAt,
      runtimeStatusError,
    };
  }
  await ctx.runMutation(internal.instances.setRuntimeStateByJobId, {
    jobId,
    runtimeStatus: nextRuntimeStatus,
    runtimeReady: parsed.ok,
    runtimeStatusUpdatedAt: updatedAt,
    runtimeStatusError,
  });
  if (parsed.ok && openclawId) {
    await ctx.scheduler.runAfter(
      0,
      internal.instances_node.syncWhatsAppConfigAfterLink,
      { openclawId },
    );
    // A (re)provisioned Instance comes back without its Agents' workspace
    // files and skills: replay the Project's registry onto it (#652).
    await ctx.scheduler.runAfter(0, internal.project_agents_node.reconcileInstanceAgents, {
      instanceId: openclawId,
    });
  }
  return {
    runtimeStatus: nextRuntimeStatus,
    runtimeReady: parsed.ok,
    runtimeStatusUpdatedAt: updatedAt,
    runtimeStatusError,
  };
}

async function scheduleRuntimeLinkRetry(
  ctx: ActionCtx,
  jobId: string,
  attempt: number,
  reason: string,
): Promise<void> {
  const delayMs =
    RUNTIME_LINK_RETRY_DELAYS_MS[attempt] ??
    RUNTIME_LINK_RETRY_DELAYS_MS[RUNTIME_LINK_RETRY_DELAYS_MS.length - 1];
  console.warn(
    `[instances_node] runtime link retry jobId=${jobId} attempt=${attempt + 1}/${RUNTIME_LINK_MAX_ATTEMPTS} delayMs=${delayMs}: ${reason}`,
  );
  await ctx.scheduler.runAfter(delayMs, internal.instances_node.verifyRuntimeLinkForJob, {
    jobId,
    attempt: attempt + 1,
  });
}

function hasRuntimeLinkAttemptsRemaining(attempt: number): boolean {
  return attempt < RUNTIME_LINK_MAX_ATTEMPTS - 1;
}

function sanitizeJob(job: InstanceJobPayload): InstanceJobPayload {
  const network = job.network
    ? {
        id: job.network.id,
        name: job.network.name,
        ipRange: job.network.ipRange,
      }
    : undefined;
  const openclaw = job.openclaw
    ? {
        openClawId: job.openclaw.openClawId,
        openClawKeyId: job.openclaw.openClawKeyId,
        name: job.openclaw.name,
        serverId: job.openclaw.serverId,
        ipv4: job.openclaw.ipv4,
        privateIp: job.openclaw.privateIp,
        gatewayToken: job.openclaw.gatewayToken,
      }
    : undefined;

  return {
    id: job.id,
    status: job.status,
    runtimeStatus: job.runtimeStatus,
    runtimeReady: job.runtimeReady,
    runtimeStatusUpdatedAt: job.runtimeStatusUpdatedAt,
    runtimeStatusError: job.runtimeStatusError,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    network,
    broker: job.broker,
    openclaw,
  };
}

function buildOpenClawNameFromJobId(jobId: string): string {
  return `openclaw-${jobId.slice(0, 8)}`;
}

// A 404 from the provisioner means the instance is already gone — that's a
// successful delete from the caller's point of view, not a failure. Shared
// by removeInstance and destroyAllInstances (issue #304: both now go
// through the same InstanceProvisioner.removeInstance, backend-agnostic).
function describeDeleteFailure(result: RemoveInstanceResult): string | null {
  const status = result.status ?? 200;
  if (status === 404) {
    return null;
  }
  if (result.error) {
    return `Project delete failed: ${result.error}`;
  }
  if (status >= 400) {
    return "Project delete failed";
  }
  return null;
}
