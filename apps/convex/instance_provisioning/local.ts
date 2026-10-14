"use node";

import { HmacSigner, callSignedJsonApi } from "@opengroow/hmac";
import { internal } from "../_generated/api.js";
import { env } from "../env.js";
import type {
  CreateInstanceArgs,
  InstanceProvisionResult,
  InstanceProvisioner,
  RemoveInstanceArgs,
  RemoveInstanceResult,
  ListInstancesArgs,
  ListInstancesResult,
  LogsArgs,
  ProvisionerApiResult,
  StatusArgs,
} from "./types.js";

const NOT_SUPPORTED_STATUS = 501;

// Self-host implements createInstance, removeInstance, list/logs/status so
// far — only rollout returns this rather than attempting a fleet
// control-plane call. A fleet-wide rollout has no local-multi equivalent
// yet — left as a follow-up.
function notSupported(action: string): { status: number; error: string } {
  return {
    status: NOT_SUPPORTED_STATUS,
    error:
      `Not supported in self-hosted mode yet: ${action} isn't wired to ` +
      "the local control plane (apps/openclaw-local-control) in this " +
      "release.",
  };
}

// OSS self-host, local-multi (issue #306): provisions a new, isolated
// Docker Compose project by calling the openclaw-local-control service
// (issue #305) over HTTP instead of recording a single hardcoded row. The
// control plane generates the id (matching the existing `local-<uuid>`
// job-id convention — see apps/openclaw-local-control/src/ids.ts) and the
// per-instance credentials; this seam just forwards them into the
// createLocalInstance mutation. The old single-Project constraint (issue
// #262's 409) is gone: each call gets its own compose project, so there's
// no reason to reject a second row anymore. See ADR-028 / ADR-033
// (docs/adr/028-*.md, docs/adr/033-*.md) for the now-superseded single-Project
// design this replaces.
export const localProvisioner: InstanceProvisioner = {
  async createInstance(ctx, args: CreateInstanceArgs): Promise<InstanceProvisionResult> {
    const created = await callLocalControlApi("POST", "/instances");
    if ("error" in created) {
      return created as InstanceProvisionResult;
    }
    // The local control-plane response is only trusted after its shape is
    // checked — a non-JSON or truncated 2xx (id/keyId/port missing or of
    // the wrong type) must not be cast straight into the Convex mutation,
    // since that would either write a garbage jobId/port or create a
    // Compose project with no matching Convex row to reference it by.
    // `port` is required too (issue #308): it's stored as this instance's
    // `openclawServerId`, which logs/status address by below.
    if (
      typeof created.id !== "string" ||
      typeof created.keyId !== "string" ||
      typeof created.port !== "number"
    ) {
      return {
        status: typeof created.status === "number" ? created.status : 502,
        error: "Malformed response from the local control plane: missing instance id/keyId/port",
      };
    }

    return await ctx.runMutation(internal.instances.createLocalInstance, {
      nameSuffix: args.nameSuffix,
      userId: args.userId,
      jobId: created.id,
      port: created.port,
      openclawKeyId: created.keyId,
      openclawGatewayToken:
        typeof created.gatewayToken === "string" ? created.gatewayToken : undefined,
    });
  },

  // OSS self-host, local-multi (issue #307): tears down the instance's
  // Docker Compose project via the local control-plane's own
  // DELETE /instances/:id (issue #305). The control plane also regenerates
  // and pushes the broker's OpenClaw-keys file and restarts the broker
  // container as a side effect of this call — see openclaw-local-control's
  // broker-sync module; Convex never talks to the broker directly.
  async removeInstance(_ctx, args: RemoveInstanceArgs): Promise<RemoveInstanceResult> {
    const deleted = await callLocalControlApi(
      "DELETE",
      `/instances/${encodeURIComponent(args.jobId)}`,
    );
    return {
      status: deleted.status as number | undefined,
      error: deleted.error as string | undefined,
      serverDeleted: deleted.removed === true,
    };
  },

  // Issue #308: mirrors control_plane.ts's list — GET a single job by id (used by
  // refreshJob) or every known job. The local control-plane's registry is
  // the source of truth (see local-control-server.ts's GET /instances[/:id]).
  async list(_ctx, args: ListInstancesArgs): Promise<ListInstancesResult> {
    const path = args.jobId ? `/instances/${args.jobId}` : "/instances";
    return (await callLocalControlApi("GET", path)) as ListInstancesResult;
  },

  // Issue #308: the dashboard passes `serverId`/`ipv4` (the control-plane's fleet
  // vocabulary), unmodified, to every backend. The local control-plane has
  // no VM/serverId of its own, so `createInstance` stores each local
  // instance's allocated compose gateway port as its `openclawServerId`
  // — reused here, forwarded as `port`, to let the control-plane's registry
  // (port -> compose project id) resolve which instance to target. The
  // "broker" target ignores it: self-host runs exactly one shared broker
  // container (not one per instance), so there's nothing to disambiguate.
  async logs(_ctx, args: LogsArgs): Promise<ProvisionerApiResult> {
    return (await callLocalControlApi("POST", `/instances/logs/${args.target}`, {
      port: args.serverId,
      tail: args.tail,
      service: args.service,
    })) as ProvisionerApiResult;
  },

  async status(_ctx, args: StatusArgs): Promise<ProvisionerApiResult> {
    return (await callLocalControlApi("POST", `/instances/status/${args.target}`, {
      port: args.serverId,
    })) as ProvisionerApiResult;
  },

  async rollout() {
    return notSupported("rollout");
  },
};

// Mirrors control_plane.ts's callControlApi — both are thin wrappers around
// @opengroow/hmac's shared callSignedJsonApi (HMAC-signed request against a
// control-plane, {status, error} on network/timeout failure, JSON-or-raw
// response parsing otherwise).
async function callLocalControlApi(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const signer = new HmacSigner({
    keyId: env.OPENCLAW_CONTROL_KEY_ID,
    secret: env.OPENCLAW_CONTROL_SECRET,
    prefix: "control",
  });
  return callSignedJsonApi({
    signer,
    baseUrl: env.OPENCLAW_CONTROL_URL,
    method,
    path,
    body,
    timeoutMs: env.OPENCLAW_CONTROL_FETCH_TIMEOUT_MS,
    serviceName: "OpenClaw local control service",
  });
}
