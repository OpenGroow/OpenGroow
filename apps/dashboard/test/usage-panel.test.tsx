/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsagePanel } from "../src/components/usage-panel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getOpenClawUsageMock = vi.fn();
const useActionMock = vi.fn();
const useAuthenticatedInstancesMock = vi.fn();

vi.mock("convex/react", () => ({
  useAction: (...args: unknown[]) => useActionMock(...args),
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    instances_node: {
      getOpenClawUsage: "instances_node.getOpenClawUsage",
    },
  },
}));

vi.mock("@/src/hooks/use-authenticated-instances", () => ({
  useAuthenticatedInstances: () => useAuthenticatedInstancesMock(),
}));

describe("UsagePanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    getOpenClawUsageMock.mockReset();
    useActionMock.mockReset();
    useAuthenticatedInstancesMock.mockReset();

    useActionMock.mockImplementation((action: string) => {
      if (action === "instances_node.getOpenClawUsage") return getOpenClawUsageMock;
      throw new Error(`Unexpected action: ${action}`);
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = "";
  });

  async function renderPanel(instanceId = "project-1") {
    await act(async () => {
      root.render(<UsagePanel instanceId={instanceId} />);
    });
  }

  it("shows a loading state while instances are resolving", async () => {
    useAuthenticatedInstancesMock.mockReturnValue(undefined);

    await renderPanel();

    expect(document.body.textContent).toContain("Loading");
  });

  it("shows a not-linked message when the project has no matching instance", async () => {
    useAuthenticatedInstancesMock.mockReturnValue([]);

    await renderPanel();

    expect(document.body.textContent).toContain("not linked");
    expect(getOpenClawUsageMock).not.toHaveBeenCalled();
  });

  it("fetches and displays a per-provider quota breakdown", async () => {
    useAuthenticatedInstancesMock.mockReturnValue([
      { _id: "id-1", jobId: "job-1", status: "ready", openclawId: "project-1", openclawServerId: 42, ipv4: "1.2.3.4" },
    ]);
    getOpenClawUsageMock.mockResolvedValue({
      status: 200,
      usage: {
        parsed: true,
        providers: [
          {
            provider: "anthropic",
            displayName: "Anthropic",
            windows: [{ label: "5h window", usedPercent: 42, resetAt: 1783090000000 }],
            plan: "Max 20x",
          },
          { provider: "openai", displayName: "OpenAI", windows: [] },
        ],
      },
    });

    await renderPanel();
    await act(async () => {
      await Promise.resolve();
    });

    expect(getOpenClawUsageMock).toHaveBeenCalledWith({ instanceId: "project-1" });
    expect(document.body.textContent).toContain("Anthropic");
    expect(document.body.textContent).toContain("OpenAI");
    expect(document.body.textContent).toContain("5h window");
    expect(document.body.textContent).toContain("42% used");
    expect(document.body.textContent).toContain("Max 20x");
    expect(document.body.textContent).not.toContain("sessionKey");
    expect(document.body.textContent).not.toContain("instanceId");
  });

  it("shows an error message when the control API is unreachable", async () => {
    useAuthenticatedInstancesMock.mockReturnValue([
      { _id: "id-1", jobId: "job-1", status: "ready", openclawId: "project-1", openclawServerId: 42, ipv4: "1.2.3.4" },
    ]);
    getOpenClawUsageMock.mockResolvedValue({
      status: 502,
      error: "OpenClaw control service unreachable",
    });

    await renderPanel();
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("Usage is temporarily unavailable");
    expect(document.body.textContent).not.toContain("OpenClaw control service unreachable");
  });

  it("shows a no-usage-yet message when the CLI reports zero providers", async () => {
    useAuthenticatedInstancesMock.mockReturnValue([
      { _id: "id-1", jobId: "job-1", status: "ready", openclawId: "project-1", openclawServerId: 42, ipv4: "1.2.3.4" },
    ]);
    getOpenClawUsageMock.mockResolvedValue({
      status: 200,
      usage: { parsed: true, providers: [] },
    });

    await renderPanel();
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("No usage data yet");
  });
});
