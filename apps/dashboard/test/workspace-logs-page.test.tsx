/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceLogsPage } from "../src/components/workspace-logs-page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getWorkspaceRunTranscriptMock = vi.fn();
const useActionMock = vi.fn();
const useQueryMock = vi.fn();
const useAuthenticatedInstancesMock = vi.fn();
const routerPushMock = vi.fn();
const searchParamsGetMock = vi.fn().mockReturnValue(null);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
  useSearchParams: () => ({ get: searchParamsGetMock }),
}));

vi.mock("convex/react", () => ({
  useAction: (...args: unknown[]) => useActionMock(...args),
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    workspace_logs: {
      listMissionsForWorkspace: "workspace_logs.listMissionsForWorkspace",
      listRunsForMission: "workspace_logs.listRunsForMission",
      listJobsForWorkspace: "workspace_logs.listJobsForWorkspace",
      listRunsForJob: "workspace_logs.listRunsForJob",
    },
    workspace_logs_node: {
      getWorkspaceRunTranscript: "workspace_logs_node.getWorkspaceRunTranscript",
    },
  },
}));

vi.mock("@/src/hooks/use-authenticated-instances", () => ({
  useAuthenticatedInstances: () => useAuthenticatedInstancesMock(),
}));

const MISSION_1 = {
  _id: "mission-1",
  name: "Weekly SEO report",
  number: 1,
  status: "done",
  updatedAt: 2000,
  createdAt: 1000,
};

const RUN_1 = {
  _id: "run-1",
  missionId: "mission-1",
  status: "completed",
  createdAt: 1500,
};

const JOB_1 = {
  _id: "job-1",
  jobType: "source_ingestion",
  agentName: "social-agent",
  lastOutcome: "failed",
  lastError: "2 Sources invalid",
  lastRunAt: 3000,
};

const GENERIC_JOB = {
  _id: "job-routing-1",
  jobType: "source_routing",
  agentName: "Source routing",
  lastOutcome: "succeeded",
  lastRunAt: 4000,
};

const JOB_RUN_1 = {
  _id: "job-run-1",
  jobId: "job-1",
  status: "failed",
  createdAt: 3000,
  errorMessage: "Sources invalid at #2",
};

describe("WorkspaceLogsPage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    routerPushMock.mockReset();
    getWorkspaceRunTranscriptMock.mockReset();
    useActionMock.mockReset();
    useQueryMock.mockReset();
    useAuthenticatedInstancesMock.mockReset();

    useAuthenticatedInstancesMock.mockReturnValue([
      { _id: "instance-record-1", jobId: "job-1", status: "ready", openclawId: "instance-1" },
    ]);
    useActionMock.mockImplementation((action: string) => {
      if (action === "workspace_logs_node.getWorkspaceRunTranscript") {
        return getWorkspaceRunTranscriptMock;
      }
      throw new Error(`Unexpected action: ${action}`);
    });
    useQueryMock.mockImplementation((query: string, args: unknown) => {
      if (query === "workspace_logs.listMissionsForWorkspace") {
        return args === "skip" ? undefined : [MISSION_1];
      }
      if (query === "workspace_logs.listRunsForMission") {
        return args === "skip" ? undefined : [RUN_1];
      }
      if (query === "workspace_logs.listJobsForWorkspace") {
        return args === "skip" ? undefined : [JOB_1];
      }
      if (query === "workspace_logs.listRunsForJob") {
        return args === "skip" ? undefined : [JOB_RUN_1];
      }
      throw new Error(`Unexpected query: ${query}`);
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

  async function renderPage() {
    const params = Promise.resolve({ projectId: "instance-1", workspaceKey: "ws-hello" });
    await act(async () => {
      root.render(<WorkspaceLogsPage params={params} />);
    });
  }

  it("requests the default transcript for the matched runtime instance and workspace key", async () => {
    getWorkspaceRunTranscriptMock.mockReturnValue(new Promise(() => {}));

    await renderPage();

    expect(getWorkspaceRunTranscriptMock).toHaveBeenCalledWith({
      instanceId: "instance-1",
      workspaceKey: "ws-hello",
    });
    expect(document.body.textContent).toContain("Loading logs");
  });

  it("lists Missions belonging to this Workspace's Agent", async () => {
    getWorkspaceRunTranscriptMock.mockReturnValue(new Promise(() => {}));

    await renderPage();

    expect(document.body.textContent).toContain("Weekly SEO report");
  });

  it("shows an empty state when the Agent has not run yet", async () => {
    getWorkspaceRunTranscriptMock.mockResolvedValue({ found: false, turns: [] });

    await renderPage();

    expect(document.body.textContent).toContain("No runs yet");
  });

  it("renders the transcript turns without exposing infra terms", async () => {
    getWorkspaceRunTranscriptMock.mockResolvedValue({
      found: true,
      turns: [
        {
          kind: "message",
          role: "user",
          text: "Write the weekly report",
          timestamp: "2026-07-02T10:00:00.000Z",
        },
        {
          kind: "message",
          role: "assistant",
          text: "Here is the report.",
          timestamp: "2026-07-02T10:00:05.000Z",
        },
      ],
      runId: "run-1",
      parent: { kind: "mission", missionId: "mission-1" },
    });

    await renderPage();

    expect(document.body.textContent).toContain("Write the weekly report");
    expect(document.body.textContent).toContain("Here is the report.");
    expect(document.body.textContent).not.toContain("sessionKey");
    expect(document.body.textContent).not.toContain("instanceId");
    expect(document.body.textContent).not.toContain("session");
  });

  it("selecting a Run requests that Run's transcript", async () => {
    getWorkspaceRunTranscriptMock
      .mockResolvedValueOnce({ found: false, turns: [], runId: "run-1", parent: { kind: "mission", missionId: "mission-1" } })
      .mockResolvedValueOnce({
        found: true,
        turns: [{ kind: "message", role: "user", text: "From the picked run" }],
        runId: "run-1",
        parent: { kind: "mission", missionId: "mission-1" },
      });

    await renderPage();

    // The default Mission is auto-expanded once its runId/missionId comes
    // back, so its Run should already be visible to click.
    const runButton = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("completed"),
    );
    if (!(runButton instanceof HTMLButtonElement)) throw new Error("Run button not found");
    await act(async () => {
      runButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(getWorkspaceRunTranscriptMock).toHaveBeenLastCalledWith({
      instanceId: "instance-1",
      workspaceKey: "ws-hello",
      runId: "run-1",
    });
    expect(document.body.textContent).toContain("From the picked run");
  });

  it("shows an error state when the action rejects", async () => {
    getWorkspaceRunTranscriptMock.mockRejectedValue(new Error("boom"));

    await renderPage();

    expect(document.body.textContent).toContain("Could not load logs");
    expect(document.body.textContent).toContain("boom");
  });

  it("navigates back to the Workspace page", async () => {
    getWorkspaceRunTranscriptMock.mockReturnValue(new Promise(() => {}));

    await renderPage();
    const button = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Back to Workspace"),
    );
    if (!(button instanceof HTMLButtonElement)) throw new Error("Back button not found");
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(routerPushMock).toHaveBeenCalledWith("/projects/instance-1/settings/workspaces/ws-hello");
  });

  it("has no back-to-Workspace button when it is an Agent page's Logs tab", async () => {
    getWorkspaceRunTranscriptMock.mockReturnValue(new Promise(() => {}));
    const params = Promise.resolve({ projectId: "instance-1", workspaceKey: "ws-hello" });
    await act(async () => {
      root.render(<WorkspaceLogsPage params={params} agentTemplateId="hello" />);
    });
    const labels = Array.from(document.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels.some((text) => text?.includes("Back to Workspace"))).toBe(false);
  });

  it("lists the Agent's job with its last outcome and error, and its Runs once expanded", async () => {
    getWorkspaceRunTranscriptMock.mockReturnValue(new Promise(() => {}));

    await renderPage();

    const text = () => document.body.textContent ?? "";
    expect(text()).toContain("social-agent job");
    expect(text()).toContain("Last outcome: failed");
    expect(text()).toContain("2 Sources invalid");
    expect(text()).not.toContain("Sources invalid at #2");

    const toggle = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("social-agent job"),
    );
    await act(async () => {
      toggle!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(text()).toContain("Sources invalid at #2");
  });

  it("selecting a job Run loads its transcript, tool calls included", async () => {
    getWorkspaceRunTranscriptMock
      .mockResolvedValueOnce({
        found: true,
        turns: [],
        runId: "job-run-1",
        parent: { kind: "job", jobId: "job-1" },
      })
      .mockResolvedValueOnce({
        found: true,
        turns: [
          { kind: "tool_call", toolName: "read_file", arguments: { path: "batch.json" } },
          { kind: "tool_result", toolName: "read_file", success: true, result: "batch content" },
        ],
        runId: "job-run-1",
        parent: { kind: "job", jobId: "job-1" },
      });

    await renderPage();

    // The default Run's job is auto-expanded once its parent comes back.
    const runButton = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Sources invalid at #2"),
    );
    if (!(runButton instanceof HTMLButtonElement)) throw new Error("job Run button not found");
    await act(async () => {
      runButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(getWorkspaceRunTranscriptMock).toHaveBeenLastCalledWith({
      instanceId: "instance-1",
      workspaceKey: "ws-hello",
      runId: "job-run-1",
    });
    expect(document.body.textContent).toContain("Tool call · read_file");
    expect(document.body.textContent).toContain("Tool result · read_file");
  });

  it("expands a generic Job when its Run transcript is selected", async () => {
    getWorkspaceRunTranscriptMock
      .mockResolvedValueOnce({
        found: true,
        turns: [],
        runId: "job-run-1",
        parent: { kind: "job", jobId: "job-routing-1" },
      })
      .mockResolvedValueOnce({
        found: true,
        turns: [{ kind: "message", role: "assistant", text: "routing transcript" }],
        runId: "job-run-1",
        parent: { kind: "job", jobId: "job-routing-1" },
      });
    useQueryMock.mockImplementation((query: string, args: unknown) => {
      if (query === "workspace_logs.listMissionsForWorkspace") return args === "skip" ? undefined : [MISSION_1];
      if (query === "workspace_logs.listJobsForWorkspace") return args === "skip" ? undefined : [GENERIC_JOB];
      if (query === "workspace_logs.listRunsForJob") return args === "skip" ? undefined : [JOB_RUN_1];
      return args === "skip" ? undefined : [RUN_1];
    });

    await renderPage();
    const runButton = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("failed"));
    if (!(runButton instanceof HTMLButtonElement)) throw new Error("generic Job Run button not found");
    await act(async () => {
      runButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(getWorkspaceRunTranscriptMock).toHaveBeenLastCalledWith({
      instanceId: "instance-1",
      workspaceKey: "ws-hello",
      runId: "job-run-1",
    });
    expect(document.body.textContent).toContain("routing transcript");
  });
});
