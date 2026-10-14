import { describe, expect, it, vi, beforeEach } from "vitest";
import { RUNTIME_NODES_PENDING_RESULT, type Command } from "@opengroow/protocol";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import { readFile } from "node:fs/promises";
import {
  handleNodesCleanupStale,
  handleNodesPendingList,
} from "../src/commands/node-commands.js";

const mockReadFile = vi.mocked(readFile);

function makeCommand(): Command {
  return { id: "cmd-1", type: "runtime.nodes.pending.list", ts: Date.now(), payload: {} };
}

function makeDeps(
  overrides: {
    approvePendingNode?: ReturnType<typeof vi.fn>;
    cleanupStaleNodes?: ReturnType<typeof vi.fn>;
    warn?: ReturnType<typeof vi.fn>;
  } = {},
) {
  return {
    gatewayClient: {
      approvePendingNode: overrides.approvePendingNode ?? vi.fn().mockResolvedValue({ output: "ok", requestId: "" }),
      cleanupStaleNodes: overrides.cleanupStaleNodes ?? vi.fn().mockResolvedValue({ removedCount: 0 }),
    },
    getRuntimeInstanceId: () => "instance-1",
    warn: overrides.warn ?? vi.fn(),
  } as any;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("handleNodesPendingList", () => {
  it("auto-approves isRepair entries and excludes them from requestIds", async () => {
    const repairId = "aaaaaaaa-0000-0000-0000-000000000000";
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        [repairId]: { requestId: repairId, isRepair: true, clientMode: "cli" },
      }) as any,
    );

    const approvePendingNode = vi.fn().mockResolvedValue({ output: "ok", requestId: repairId });
    const result = await handleNodesPendingList(makeCommand(), makeDeps({ approvePendingNode }));

    expect(approvePendingNode).toHaveBeenCalledWith(repairId);
    expect(result.event.type).toBe(RUNTIME_NODES_PENDING_RESULT);
    expect((result.event.payload as any).data.requestIds).toEqual([]);
  });

  it("returns non-repair entries in requestIds without approving them", async () => {
    const nodeId = "bbbbbbbb-0000-0000-0000-000000000000";
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        [nodeId]: { requestId: nodeId, isRepair: false, clientMode: "node" },
      }) as any,
    );

    const approvePendingNode = vi.fn();
    const result = await handleNodesPendingList(makeCommand(), makeDeps({ approvePendingNode }));

    expect(approvePendingNode).not.toHaveBeenCalled();
    expect((result.event.payload as any).data.requestIds).toEqual([nodeId]);
  });

  it("auto-approves repair entries and only returns non-repair entries when both are present", async () => {
    const repairId = "cccccccc-0000-0000-0000-000000000000";
    const nodeId = "dddddddd-0000-0000-0000-000000000000";
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        [repairId]: { requestId: repairId, isRepair: true },
        [nodeId]: { requestId: nodeId, isRepair: false },
      }) as any,
    );

    const approvePendingNode = vi.fn().mockResolvedValue({ output: "ok", requestId: repairId });
    const result = await handleNodesPendingList(makeCommand(), makeDeps({ approvePendingNode }));

    expect(approvePendingNode).toHaveBeenCalledOnce();
    expect(approvePendingNode).toHaveBeenCalledWith(repairId);
    expect((result.event.payload as any).data.requestIds).toEqual([nodeId]);
  });

  it("warns and continues when auto-approval fails", async () => {
    const repairId = "eeeeeeee-0000-0000-0000-000000000000";
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        [repairId]: { requestId: repairId, isRepair: true },
      }) as any,
    );

    const approvePendingNode = vi.fn().mockRejectedValue(new Error("Gateway down"));
    const warn = vi.fn();
    const result = await handleNodesPendingList(makeCommand(), makeDeps({ approvePendingNode, warn }));

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Gateway down"));
    expect((result.event.payload as any).ok).toBe(true);
    expect((result.event.payload as any).data.requestIds).toEqual([]);
  });
});

describe("handleNodesCleanupStale", () => {
  function makeCleanupCommand(): Command {
    return { id: "cmd-cleanup-1", type: "runtime.nodes.cleanup_stale", ts: Date.now(), payload: {} };
  }

  it("returns ok with the removed count from the gateway client", async () => {
    const cleanupStaleNodes = vi.fn().mockResolvedValue({ removedCount: 3 });
    const result = await handleNodesCleanupStale(makeCleanupCommand(), makeDeps({ cleanupStaleNodes }));

    expect(cleanupStaleNodes).toHaveBeenCalledOnce();
    expect((result.event.payload as any).ok).toBe(true);
    expect((result.event.payload as any).data).toEqual({ removedCount: 3 });
  });

  it("reports failure without throwing when the gateway client errors", async () => {
    const cleanupStaleNodes = vi.fn().mockRejectedValue(new Error("control socket unreachable"));
    const result = await handleNodesCleanupStale(makeCleanupCommand(), makeDeps({ cleanupStaleNodes }));

    expect((result.event.payload as any).ok).toBe(false);
    expect((result.event.payload as any).error).toContain("control socket unreachable");
    expect((result.event.payload as any).data).toEqual({ removedCount: 0 });
  });
});
