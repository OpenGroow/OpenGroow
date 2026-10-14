export const RUNTIME_NODES_PENDING_LIST = "runtime.nodes.pending.list" as const;
export const RUNTIME_NODES_APPROVE = "runtime.nodes.approve" as const;
export const RUNTIME_NODES_PENDING_RESULT = "runtime.nodes.pending.result" as const;
export const RUNTIME_NODES_APPROVE_RESULT = "runtime.nodes.approve.result" as const;
export const RUNTIME_NODES_CHECK = "runtime.nodes.check" as const;
export const RUNTIME_NODES_CHECK_RESULT = "runtime.nodes.check.result" as const;
export const RUNTIME_NODES_CLEANUP_STALE = "runtime.nodes.cleanup_stale" as const;
export const RUNTIME_NODES_CLEANUP_STALE_RESULT =
  "runtime.nodes.cleanup_stale.result" as const;

export type RuntimeNodesPendingListCommandPayload = {
  commandId?: string;
};

export type RuntimeNodesApproveCommandPayload = {
  commandId?: string;
  requestId: string;
};

export type RuntimeNodesPendingResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    output: string;
    requestIds: string[];
  };
};

export type RuntimeNodesApproveResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    output: string;
    requestId: string;
  };
};
