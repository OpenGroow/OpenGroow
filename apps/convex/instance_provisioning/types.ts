import type { ActionCtx } from "../_generated/server.js";
import type { InstanceJobStatus, RuntimeStatus } from "@opengroow/protocol";

export type InstanceJobPayload = {
  id: string;
  status: InstanceJobStatus;
  runtimeStatus: RuntimeStatus;
  runtimeReady?: boolean;
  runtimeStatusUpdatedAt?: string;
  runtimeStatusError?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  network?: {
    id: number;
    name: string;
    ipRange: string;
  };
  broker?: {
    serverId: number;
    name: string;
    ipv4?: string;
    privateIp?: string;
  };
  openclaw?: {
    serverId: number;
    name: string;
    ipv4?: string;
    privateIp?: string;
    openClawId: string;
    openClawKeyId: string;
    gatewayToken?: string;
  };
};

export type CreateInstanceArgs = {
  nameSuffix?: string;
  openClawImageRef?: string;
  userId: string;
};

export type InstanceProvisionResult = {
  job?: InstanceJobPayload;
  status?: number;
  error?: string;
};

export type RemoveInstanceArgs = {
  jobId: string;
  serverId?: number;
  serverName?: string;
  peerName?: string;
};

export type RemoveInstanceResult = {
  status?: number;
  error?: string;
  serverDeleted?: boolean;
};

export type ListInstancesArgs = {
  // When set, fetch a single job by id. Omitted, fetch every job — the
  // "list" half of the widened interface (issue #304).
  jobId?: string;
};

export type ListInstancesResult = {
  job?: InstanceJobPayload;
  jobs?: InstanceJobPayload[];
  status?: number;
  error?: string;
};

// Both the logs and status RPCs are per-instance but split by which process
// on the instance they target — see instances_node.ts's getOpenClaw*/getBroker*
// actions this interface now backs.
export type InstanceLogTarget = "openclaw" | "broker";

export type LogsArgs = {
  target: InstanceLogTarget;
  serverId?: number;
  ipv4?: string;
  service?: string;
  tail?: number;
};

export type StatusArgs = {
  target: InstanceLogTarget;
  serverId?: number;
  ipv4?: string;
};

export type RolloutArgs = {
  ips: string[];
  openClawImageRef?: string;
  concurrency?: number;
  refreshCompose?: boolean;
};

// Raw passthrough of the control-plane JSON response — callers (dashboard
// actions) forward this shape to the client as-is.
export type ProvisionerApiResult = {
  status?: number;
  error?: string;
  [key: string]: unknown;
};

// The generic Mission/Run/Review engine (createJob in instances_node.ts) depends
// only on this interface, never on a concrete provisioning backend — see ADR-028.
//
// Widened (issue #304) from create-only to the full instance lifecycle, plus
// the fleet-wide rollout action — instances_node.ts never calls the
// control-plane client directly for any of these.
// The local (self-host) backend implements only createInstance for now;
// the rest return a "not supported yet" result — see local.ts.
export interface InstanceProvisioner {
  createInstance(ctx: ActionCtx, args: CreateInstanceArgs): Promise<InstanceProvisionResult>;
  removeInstance(ctx: ActionCtx, args: RemoveInstanceArgs): Promise<RemoveInstanceResult>;
  list(ctx: ActionCtx, args: ListInstancesArgs): Promise<ListInstancesResult>;
  logs(ctx: ActionCtx, args: LogsArgs): Promise<ProvisionerApiResult>;
  status(ctx: ActionCtx, args: StatusArgs): Promise<ProvisionerApiResult>;
  rollout(ctx: ActionCtx, args: RolloutArgs): Promise<ProvisionerApiResult>;
}
