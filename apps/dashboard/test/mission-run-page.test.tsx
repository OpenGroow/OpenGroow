/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissionRunShell } from "../src/components/mission-run-page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();
const pathnameMock = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }));
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useAction: () => vi.fn(),
}));
vi.mock("@convex/_generated/api", () => ({
  api: {
    missions: { get: "missions.get" },
    runs: { get: "runs.get" },
    workspace_logs_node: { getWorkspaceRunTranscript: "workspace_logs_node.getWorkspaceRunTranscript" },
  },
}));
// The Agent workspace lookups are not what this page is about.
vi.mock("@/src/components/agent-workspace-view", () => ({ AgentWorkspaceView: () => null }));
vi.mock("@/src/components/workspace-prompt-page", () => ({ WorkspacePromptPage: () => null }));
vi.mock("@/src/hooks/use-runtime-instance-id", () => ({ useRuntimeInstanceId: () => "instance-1" }));

describe("MissionRunShell", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useQueryMock.mockReset();
    pathnameMock.mockReturnValue("/projects/instance-1/missions/mission-1/runs/run-1/prompt");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render() {
    await act(async () => {
      root.render(
        <MissionRunShell instanceId="instance-1" missionId="mission-1" runId="run-1">
          <p>tab content</p>
        </MissionRunShell>,
      );
    });
  }

  it("names the Mission, links back to it, and offers the Run's Prompt and Logs as tabs", async () => {
    useQueryMock.mockImplementation((key: string) =>
      key === "missions.get" ? { type: "create_letter_video" } : { templateId: "@example/video" },
    );
    await render();

    const links = Array.from(container.querySelectorAll("a"));
    const back = links.find((a) => a.textContent?.includes("Create Letter Video"));
    expect(back?.getAttribute("href")).toBe("/projects/instance-1/missions/mission-1");
    const tabs = links.filter((a) => a.textContent === "Prompt" || a.textContent === "Logs");
    expect(tabs.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Prompt", "/projects/instance-1/missions/mission-1/runs/run-1/prompt"],
      ["Logs", "/projects/instance-1/missions/mission-1/runs/run-1/logs"],
    ]);
    expect(tabs[0]!.getAttribute("aria-current")).toBe("page");
    expect(container.textContent).toContain("tab content");
  });

  it("says so when the Run or the Mission does not exist", async () => {
    useQueryMock.mockReturnValue(null);
    await render();
    expect(container.textContent).toContain("This Run was not found.");
    expect(container.textContent).not.toContain("tab content");
  });
});
