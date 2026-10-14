"use node";

import { HmacSigner, callSignedJsonApi } from "@opengroow/hmac";
import { env } from "../env.js";
import type {
  CreateInstanceArgs,
  InstanceProvisionResult,
  InstanceProvisioner,
  ListInstancesArgs,
  ListInstancesResult,
  LogsArgs,
  ProvisionerApiResult,
  RemoveInstanceArgs,
  RemoveInstanceResult,
  RolloutArgs,
  StatusArgs,
} from "./types.js";

// Generic remote control-plane provisioner: an HMAC-signed HTTP client to the
// service behind OPENCLAW_CONTROL_URL. The product knows nothing about what
// that service provisions; the API it must implement is documented in
// docs/CONTROL_PLANE.md and pinned by test/control_plane_provisioner.test.ts.
// Covers the full instance lifecycle plus the fleet-wide rollout action, so
// instances_node.ts never needs to call callControlApi directly.
export const controlPlaneProvisioner: InstanceProvisioner = {
  async createInstance(_ctx, args: CreateInstanceArgs): Promise<InstanceProvisionResult> {
    return (await callControlApi("POST", "/instances/jobs", {
      nameSuffix: args.nameSuffix?.trim() || undefined,
      openClawImageRef: args.openClawImageRef?.trim() || undefined,
    })) as InstanceProvisionResult;
  },

  async removeInstance(_ctx, args: RemoveInstanceArgs): Promise<RemoveInstanceResult> {
    return (await callControlApi("POST", "/instances/delete", {
      jobId: args.jobId,
      serverId: args.serverId,
      serverName: args.serverName,
      peerName: args.peerName,
    })) as RemoveInstanceResult;
  },

  async list(_ctx, args: ListInstancesArgs): Promise<ListInstancesResult> {
    const path = args.jobId
      ? `/instances/jobs/${args.jobId}`
      : "/instances/jobs";
    return (await callControlApi("GET", path)) as ListInstancesResult;
  },

  async logs(_ctx, args: LogsArgs): Promise<ProvisionerApiResult> {
    return (await callControlApi("POST", `/instances/logs/${args.target}`, {
      serverId: args.serverId,
      ipv4: args.ipv4,
      service: args.service,
      tail: args.tail,
    })) as ProvisionerApiResult;
  },

  async status(_ctx, args: StatusArgs): Promise<ProvisionerApiResult> {
    return (await callControlApi("POST", `/instances/status/${args.target}`, {
      serverId: args.serverId,
      ipv4: args.ipv4,
    })) as ProvisionerApiResult;
  },

  async rollout(_ctx, args: RolloutArgs): Promise<ProvisionerApiResult> {
    return (await callControlApi("POST", "/instances/rollout", {
      ips: args.ips,
      openClawImageRef: args.openClawImageRef,
      concurrency: args.concurrency,
      refreshCompose: args.refreshCompose,
    })) as ProvisionerApiResult;
  },
};

export async function callControlApi(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
) {
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
    serviceName: "OpenClaw control service",
  });
}
