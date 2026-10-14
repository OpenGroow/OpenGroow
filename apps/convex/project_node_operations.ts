"use node";

import { action, type ActionCtx } from "./_generated/server.js";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import {
  RUNTIME_NODES_APPROVE,
  RUNTIME_NODES_CHECK,
  RUNTIME_NODES_PENDING_LIST,
} from "@opengroow/protocol";
import {
  enqueueInteractiveCommand,
  waitForRuntimeEvent,
} from "./runtime_commands_node";
import {
  parseRuntimeNodesApprovePayload,
  parseRuntimeNodesCheckPayload,
  parseRuntimeNodesPendingPayload,
} from "./runtime_commands_node_parsers";

export type ProjectPendingNodesResult = {
  ok: boolean;
  output: string;
  requestIds: string[];
  error?: string;
};

export type ProjectNodeCheckResult = {
  ok: boolean;
  connectedCount: number;
  repairing: boolean;
  devices: Array<{ displayName: string; caps: string[] }>;
  error?: string;
};

async function readRuntimeResult(
  ctx: ActionCtx,
  instanceId: string,
  type: string,
  payload: unknown,
): Promise<{ type?: string; payload?: unknown; error?: string }> {
  const dispatch = await enqueueInteractiveCommand(ctx, {
    instanceId,
    type,
    payload,
  });
  if (!dispatch.accepted || !dispatch.commandId) {
    return { error: "Runtime command was not accepted" };
  }
  const result = await waitForRuntimeEvent(ctx, instanceId, dispatch.commandId);
  if (!result.found) {
    return {
      error:
        result.status === 500
          ? "Runtime command dispatch failed"
          : "Runtime command timed out",
    };
  }
  return { type: result.type, payload: result.payload };
}

async function readPendingNodes(
  ctx: ActionCtx,
  instanceId: string,
): Promise<ProjectPendingNodesResult> {
  const result = await readRuntimeResult(ctx, instanceId, RUNTIME_NODES_PENDING_LIST, {});
  const parsed = parseRuntimeNodesPendingPayload(result.type, result.payload);
  if (!parsed) {
    return {
      ok: false,
      output: "",
      requestIds: [],
      error: result.error ?? "Unexpected runtime node result",
    };
  }
  return {
    ok: parsed.ok,
    output: parsed.data.output,
    requestIds: parsed.data.requestIds,
    error: parsed.error,
  };
}

export const listPendingNodes = action({
  args: { instanceId: v.string() },
  handler: async (ctx, args): Promise<ProjectPendingNodesResult> =>
    readPendingNodes(ctx, args.instanceId.trim()),
});

export const approvePendingNode = action({
  args: { instanceId: v.string() },
  handler: async (ctx, args): Promise<ProjectPendingNodesResult> => {
    const instanceId = args.instanceId.trim();
    const pending = await readPendingNodes(ctx, instanceId);
    if (!pending.ok || pending.requestIds.length !== 1) {
      return {
        ...pending,
        error:
          pending.error ??
          (pending.requestIds.length > 1
            ? "Multiple pending devices detected"
            : "No pending device request found"),
      };
    }

    const result = await readRuntimeResult(ctx, instanceId, RUNTIME_NODES_APPROVE, {
      requestId: pending.requestIds[0],
    });
    const parsed = parseRuntimeNodesApprovePayload(result.type, result.payload);
    if (!parsed) {
      return {
        ok: false,
        output: "",
        requestIds: [],
        error: result.error ?? "Unexpected runtime node approval result",
      };
    }
    return {
      ok: parsed.ok,
      output: parsed.data.output,
      requestIds: parsed.ok ? [] : pending.requestIds,
      error: parsed.error,
    };
  },
});

export const checkConnectedDevices = action({
  args: { instanceId: v.string() },
  handler: async (ctx, args): Promise<ProjectNodeCheckResult> => {
    const instanceId = args.instanceId.trim();
    const result = await readRuntimeResult(ctx, instanceId, RUNTIME_NODES_CHECK, {});
    const parsed = parseRuntimeNodesCheckPayload(result.type, result.payload);
    if (!parsed) {
      return {
        ok: false,
        connectedCount: 0,
        repairing: false,
        devices: [],
        error: result.error ?? "Unexpected runtime node check result",
      };
    }

    const devices = parsed.data.nodes;
    if (parsed.ok) {
      await ctx.runMutation(internal.connected_devices.upsertMany, {
        instanceId,
        connectedAt: Date.now(),
        devices,
      });
    }
    return {
      ok: parsed.ok,
      connectedCount: parsed.data.connectedCount,
      repairing: parsed.data.repairing === true,
      devices,
      error: parsed.error,
    };
  },
});

export const confirmConnectedDevices = action({
  args: { instanceId: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const instanceId = args.instanceId.trim();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await readRuntimeResult(ctx, instanceId, RUNTIME_NODES_CHECK, {});
      const parsed = parseRuntimeNodesCheckPayload(result.type, result.payload);
      if (!parsed?.ok) return false;
      if (parsed.data.nodes.length > 0) {
        await ctx.runMutation(internal.connected_devices.upsertMany, {
          instanceId,
          connectedAt: Date.now(),
          devices: parsed.data.nodes,
        });
        return true;
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, [1000, 2000, 2000][attempt]));
    }
    return false;
  },
});
