import { readFile } from "node:fs/promises";
import {
  RUNTIME_HEALTH_RESULT,
  RUNTIME_NODES_APPROVE_RESULT,
  RUNTIME_NODES_CHECK_RESULT,
  RUNTIME_NODES_CLEANUP_STALE_RESULT,
  RUNTIME_NODES_PENDING_RESULT,
  type Command,
} from "@opengroow/protocol";
import {
  partitionPendingDevices,
  readRequestId,
} from "./command-inputs.js";
import { createEventMessage } from "./event-message.js";
import type { CommandHandler, RuntimeDeps } from "./types.js";

const PENDING_DEVICES_PATH =
  process.env.OPENCLAW_PENDING_DEVICES_PATH?.trim() ||
  "/home/node/.openclaw/devices/pending.json";

export const handleNodesPendingList: CommandHandler = async (
  command,
  deps,
) => {
  try {
    // Source 1 (local filesystem) and source 2 (control socket) are
    // independent — running them in parallel avoids a sequential network
    // round-trip on every poll of the connection wizard.
    const [fileOutput, pendingData] = await Promise.all([
      readPendingDevicesSnapshot(),
      (async () => {
        try {
          return await deps.gatewayClient.listPendingNodes();
        } catch {
          return null;
        }
      })(),
    ]);
    const { userRequestIds: fileUserIds, repairRequestIds } = partitionPendingDevices(fileOutput);

    // Auto-approve repair requests
    await Promise.all(
      repairRequestIds.map(async (requestId) => {
        try {
          await deps.gatewayClient.approvePendingNode(requestId);
        } catch (err) {
          deps.warn(
            `[nodes-pending] auto-approval failed for repair request ${requestId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }),
    );

    // Source 2 : relay-ticket pending-approval nodes via gateway control socket
    // (non-fatal: control socket may not have this endpoint yet)
    let relayUserIds: string[] = [];
    if (pendingData) {
      // Also partition the legacy output from the control socket response
      const { userRequestIds: socketFileIds } = partitionPendingDevices(pendingData.legacy);
      relayUserIds = [
        ...socketFileIds.filter((id) => !fileUserIds.includes(id)),
        ...pendingData.relayRequestIds.filter((id) => typeof id === "string" && id.length > 0),
      ];
    }

    const allUserIds = [...new Set([...fileUserIds, ...relayUserIds])];

    return createEventMessage(RUNTIME_NODES_PENDING_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: true,
      data: {
        output: fileOutput,
        requestIds: allUserIds,
      },
    });
  } catch (error) {
    return createEventMessage(RUNTIME_NODES_PENDING_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error:
        error instanceof Error ? error.message : "Failed to list pending devices",
      data: {
        output: "",
        requestIds: [],
      },
    });
  }
};

async function readPendingDevicesSnapshot(): Promise<string> {
  try {
    const output = (await readFile(PENDING_DEVICES_PATH, "utf8")).trim();
    return output.length > 0 ? output : "{}";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "{}";
    }
    throw error;
  }
}

export const handleRuntimeHealthCheck: CommandHandler = async (
  command,
  deps,
) => {
  try {
    const response = await deps.gatewayClient.requestGatewayHealth();
    const ok = response.statusCode >= 200 && response.statusCode < 300;
    return createEventMessage(RUNTIME_HEALTH_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok,
      error: ok
        ? undefined
        : `Gateway health responded with status ${response.statusCode}`,
      data: {
        output: response.body.trim() || `HTTP ${response.statusCode}`,
      },
    });
  } catch (error) {
    return createEventMessage(RUNTIME_HEALTH_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error:
        error instanceof Error ? error.message : "Runtime health check failed",
      data: {
        output: "",
      },
    });
  }
};

export const handleNodesCheck: CommandHandler = async (command, deps) => {
  try {
    const data = await deps.gatewayClient.checkNodes();
    return createEventMessage(RUNTIME_NODES_CHECK_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: true,
      data,
    });
  } catch (error) {
    return createEventMessage(RUNTIME_NODES_CHECK_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error: error instanceof Error ? error.message : "Failed to check nodes",
      data: { connectedCount: 0, nodes: [] },
    });
  }
};

export const handleNodesCleanupStale: CommandHandler = async (command, deps) => {
  try {
    const data = await deps.gatewayClient.cleanupStaleNodes();
    return createEventMessage(RUNTIME_NODES_CLEANUP_STALE_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: true,
      data,
    });
  } catch (error) {
    return createEventMessage(RUNTIME_NODES_CLEANUP_STALE_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error: error instanceof Error ? error.message : "Failed to clean up stale nodes",
      data: { removedCount: 0 },
    });
  }
};

export async function handleNodeApprove(
  command: Command,
  deps: RuntimeDeps,
): Promise<ReturnType<typeof createEventMessage>> {
  const requestId = readRequestId(command.payload);
  if (!requestId) {
    return createEventMessage(RUNTIME_NODES_APPROVE_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error: "requestId is required",
      data: {
        output: "",
        requestId: "",
      },
    });
  }

  try {
    const result = await deps.gatewayClient.approvePendingNode(requestId);
    return createEventMessage(RUNTIME_NODES_APPROVE_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: true,
      data: {
        output: result.output,
        requestId,
      },
    });
  } catch (error) {
    return createEventMessage(RUNTIME_NODES_APPROVE_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error: error instanceof Error ? error.message : "Failed to approve node",
      data: {
        output: "",
        requestId,
      },
    });
  }
}
