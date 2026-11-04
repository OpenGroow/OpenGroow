/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectLinkWizard } from "../src/components/instance-workspace/connect-link-wizard";
import type { InstanceRecord } from "../src/components/instance-workspace.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const createConnectTicketMock = vi.fn();
const listPendingNodesMock = vi.fn();
const approvePendingNodeMock = vi.fn();
const confirmConnectedDevicesMock = vi.fn();

vi.mock("convex/react", () => ({
  useAction: (fn: unknown) => {
    switch (fn) {
      case "connect_tickets_node.createConnectTicket":
        return createConnectTicketMock;
      case "connect_tickets_node.getLatestActiveTicketForInstance":
        return vi.fn();
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

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function approveButton(container: HTMLElement) {
  return Array.from(container.querySelectorAll("button")).find((button) =>
    /approve/i.test(button.textContent ?? ""),
  );
}

describe("ConnectLinkWizard approval step", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    createConnectTicketMock.mockReset();
    listPendingNodesMock.mockReset();
    approvePendingNodeMock.mockReset();
    confirmConnectedDevicesMock.mockReset();
    confirmConnectedDevicesMock.mockResolvedValue(false);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("tells the two approvals apart: device first, then its capabilities", async () => {
    listPendingNodesMock
      .mockResolvedValueOnce({ ok: true, output: "", requestIds: ["device-id"] })
      .mockResolvedValueOnce({ ok: true, output: "", requestIds: [] })
      .mockResolvedValue({ ok: true, output: "", requestIds: ["surface-id"] });
    approvePendingNodeMock.mockResolvedValue({ ok: true, output: "", requestIds: [] });

    await act(async () => {
      root.render(<ConnectLinkWizard instance={instance} startFresh />);
    });
    await advance(0);

    expect(approveButton(container)?.textContent).toBe("Approve device (1/2)");
    expect(container.textContent).toContain("The gateway asks for two approvals");

    await act(async () => {
      approveButton(container)?.click();
    });
    await advance(6_000);

    expect(approveButton(container)?.textContent).toBe("Approve capabilities (2/2)");
  });

  it("explains what it is waiting for when the relay asks for approval but no request is listed yet", async () => {
    createConnectTicketMock.mockResolvedValue({
      ticket: {
        connectUrl: "wss://relay/connect/ticket-1/gateway",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        nodeRunCommand: "pnpm openclaw-connect:node-run",
      },
    });
    listPendingNodesMock.mockResolvedValue({ ok: true, output: "", requestIds: [] });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ session: { phase: "approval_required" } }),
      }),
    );

    await act(async () => {
      root.render(<ConnectLinkWizard instance={instance} startFresh />);
    });
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => /create connect link/i.test(button.textContent ?? ""))
        ?.click();
    });
    await advance(3_000);

    expect(container.textContent).not.toContain("Waiting for the pending device request id");
    expect(container.textContent).toContain("Looking for the approval request");
    vi.unstubAllGlobals();
  });
});
