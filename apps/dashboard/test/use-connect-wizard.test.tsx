/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectWizard } from "../src/components/instance-workspace/use-connect-wizard";
import type { InstanceRecord } from "../src/components/instance-workspace.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const createConnectTicketMock = vi.fn();
const getLatestActiveTicketForInstanceMock = vi.fn();
const listPendingNodesMock = vi.fn();
const approvePendingNodeMock = vi.fn();
const confirmConnectedDevicesMock = vi.fn();

vi.mock("convex/react", () => ({
  useAction: (fn: unknown) => {
    switch (fn) {
      case "connect_tickets_node.createConnectTicket":
        return createConnectTicketMock;
      case "connect_tickets_node.getLatestActiveTicketForInstance":
        return getLatestActiveTicketForInstanceMock;
      case "project_node_operations.listPendingNodes":
        return listPendingNodesMock;
      case "project_node_operations.approvePendingNode":
        return approvePendingNodeMock;
      case "project_node_operations.confirmConnectedDevices":
        return confirmConnectedDevicesMock;
      default:
        throw new Error(`Unmocked action: ${String(fn)}`);
    }
  },
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    connect_tickets_node: {
      createConnectTicket: "connect_tickets_node.createConnectTicket",
      getLatestActiveTicketForInstance:
        "connect_tickets_node.getLatestActiveTicketForInstance",
    },
    project_node_operations: {
      listPendingNodes: "project_node_operations.listPendingNodes",
      approvePendingNode: "project_node_operations.approvePendingNode",
      confirmConnectedDevices: "project_node_operations.confirmConnectedDevices",
    },
  },
}));

const instance: InstanceRecord = {
  _id: "instance-1",
  jobId: "job-1",
  status: "running",
  openclawId: "openclaw-1",
  openclawGatewayToken: "token-1",
};

type HookHandle = ReturnType<typeof useConnectWizard>;

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function HookHarness({
  onUpdate,
}: {
  onUpdate: (hook: HookHandle) => void;
}) {
  const hook = useConnectWizard(instance, true);
  onUpdate(hook);
  return null;
}

describe("useConnectWizard approve race condition", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latestHook: HookHandle;

  beforeEach(() => {
    vi.useFakeTimers();
    createConnectTicketMock.mockReset();
    getLatestActiveTicketForInstanceMock.mockReset();
    listPendingNodesMock.mockReset();
    approvePendingNodeMock.mockReset();
    confirmConnectedDevicesMock.mockReset();

    createConnectTicketMock.mockResolvedValue({
      ticket: {
        connectUrl: "wss://relay/connect/ticket-1/gateway",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        nodeRunCommand: "pnpm openclaw-connect:node-run -- --relay-url wss://relay/connect/ticket-1/gateway",
      },
    });

    listPendingNodesMock.mockResolvedValue({
      ok: true,
      output: "",
      requestIds: ["fresh-id"],
    });
    approvePendingNodeMock.mockResolvedValue({
      ok: true,
      output: "",
      requestIds: [],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ session: { phase: "waiting_for_device" } }),
      }),
    );

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("re-fetches the pending requestId before approving instead of sending a stale one", async () => {
    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(hook) => {
            latestHook = hook;
          }}
        />,
      );
    });

    await act(async () => {
      await latestHook.handleCreateConnectTicket();
    });

    // The hook receives a typed Project operation result and moves to approval_required.
    await advance(5_000);
    expect(latestHook.pendingNodeRequestId).toBe("fresh-id");
    expect(latestHook.wizardPhase).toBe("approval_required");

    await act(async () => {
      await latestHook.handleApproveDevice();
    });

    expect(approvePendingNodeMock).toHaveBeenCalledWith({ instanceId: "openclaw-1" });
  });
});

describe("useConnectWizard second approval round (scope upgrade)", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latestHook: HookHandle;
  let sessionPhase: string;

  beforeEach(() => {
    vi.useFakeTimers();
    createConnectTicketMock.mockReset();
    getLatestActiveTicketForInstanceMock.mockReset();
    listPendingNodesMock.mockReset();
    approvePendingNodeMock.mockReset();
    confirmConnectedDevicesMock.mockReset();

    createConnectTicketMock.mockResolvedValue({
      ticket: {
        connectUrl: "wss://relay/connect/ticket-1/gateway",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        nodeRunCommand: "pnpm openclaw-connect:node-run -- --relay-url wss://relay/connect/ticket-1/gateway",
      },
    });

    // The gateway can require a *second*, separate approval round for the
    // same node after the first one succeeds (a scope-upgrade grant for its
    // actual capabilities) — the underlying WS session stays "connected" at
    // the relay throughout, even while this second request is pending.
    listPendingNodesMock
      .mockResolvedValueOnce({ ok: true, output: "", requestIds: ["first-id"] })
      .mockResolvedValue({ ok: true, output: "", requestIds: ["second-id"] });
    approvePendingNodeMock.mockResolvedValue({ ok: true, output: "", requestIds: [] });

    sessionPhase = "waiting_for_device";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => ({
        ok: true,
        json: async () => ({ session: { phase: sessionPhase } }),
      })),
    );

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not trust a relay 'connected' report over a fresh pending device once approval was already submitted", async () => {
    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(hook) => {
            latestHook = hook;
          }}
        />,
      );
    });

    await act(async () => {
      await latestHook.handleCreateConnectTicket();
    });

    await advance(5_000);
    expect(latestHook.pendingNodeRequestId).toBe("first-id");
    expect(latestHook.wizardPhase).toBe("approval_required");

    await act(async () => {
      await latestHook.handleApproveDevice();
    });
    expect(latestHook.approvalSubmitted).toBe(true);

    // The relay now reports the WS session as connected — but the gateway
    // actually still has a second request ("second-id") pending for this
    // same node. The hook must catch that instead of declaring "connected".
    sessionPhase = "connected";
    await advance(5_000);

    expect(latestHook.wizardPhase).toBe("approval_required");
    expect(latestHook.pendingNodeRequestId).toBe("second-id");
    expect(latestHook.approvalSubmitted).toBe(false);
  });
});
