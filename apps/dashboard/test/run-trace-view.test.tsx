/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunTraceView } from "../src/components/trace/run-trace-view";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useQueryMock = vi.fn();
const transcriptMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useAction: () => transcriptMock,
}));
vi.mock("@convex/_generated/api", () => ({
  api: {
    runs: { get: "runs.get" },
    workspace_logs_node: { getWorkspaceRunTranscript: "getWorkspaceRunTranscript" },
  },
}));
vi.mock("@/src/hooks/use-runtime-instance-id", () => ({ useRuntimeInstanceId: () => "instance-1" }));

const ts = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
const params = Promise.resolve({ projectId: "p1", workspaceKey: "w1" });

describe("RunTraceView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useQueryMock.mockReset();
    transcriptMock.mockReset();
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
        <React.Suspense fallback={null}>
          <RunTraceView params={params} runId={"run-1" as never} />
        </React.Suspense>,
      );
    });
    await act(async () => {});
  }

  it("shows the summary and the timeline of a transcript", async () => {
    useQueryMock.mockReturnValue({ _id: "run-1", status: "completed", createdAt: 0, completedAt: 12_000 });
    transcriptMock.mockResolvedValue({
      found: true,
      turns: [
        { kind: "message", role: "user", text: "Write the article", timestamp: ts(0) },
        { kind: "tool_call", toolName: "media.generate", toolCallId: "c1", arguments: { q: 1 }, timestamp: ts(1) },
        { kind: "tool_result", toolName: "media.generate", toolCallId: "c1", success: false, result: "boom", timestamp: ts(3) },
        { kind: "message", role: "assistant", text: "Done", timestamp: ts(4) },
      ],
    });
    await render();

    const summary = container.querySelector('[data-testid="trace-summary"]')!.textContent!;
    expect(summary).toContain("12 s");
    expect(summary).toMatch(/Tool Calls\s*1/);
    expect(summary).toMatch(/Failed Tool Calls\s*1/);
    expect(container.querySelectorAll('[data-testid="trace-event-instruction"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="trace-event-agent"]')).toHaveLength(1);
    const tool = container.querySelector('[data-testid="trace-event-tool"]')!;
    expect(tool.textContent).toContain("generate");
    expect(tool.textContent).toContain("media");
    expect(tool.querySelector('[data-testid="tool-status"]')!.textContent).toBe("Failed");
    expect(tool.textContent).toContain("2.0 s");
  });

  it("renders a waterfall: axis, two-line labels, bars only for timestamped events", async () => {
    useQueryMock.mockReturnValue({ _id: "run-1", status: "completed", createdAt: 0, completedAt: 12_000 });
    transcriptMock.mockResolvedValue({
      found: true,
      turns: [
        { kind: "message", role: "user", text: "Write the article", timestamp: ts(0) },
        { kind: "tool_call", toolName: "read", toolCallId: "c1", arguments: { path: "docs/run.md" }, timestamp: ts(2) },
        { kind: "tool_result", toolName: "read", toolCallId: "c1", success: true, result: "ok", timestamp: ts(4) },
        { kind: "tool_call", toolName: "seo-mcp__list_keywords", toolCallId: "c2", arguments: {}, timestamp: ts(6) },
        { kind: "tool_result", toolName: "seo-mcp__list_keywords", toolCallId: "c2", success: true, result: "ok", timestamp: ts(8) },
        { kind: "message", role: "assistant", text: "No timestamp" },
      ],
    });
    await render();
    const text = container.textContent!;
    expect(text).toContain("Execution");
    expect(text).toContain("8.0 s");
    const [file, mcp] = container.querySelectorAll('[data-testid="trace-event-tool"]');
    expect(file.textContent).toContain("run.md");
    expect(mcp.textContent).toContain("list_keywords");
    expect(mcp.textContent).toContain("seo-mcp");
    expect(container.querySelectorAll('[data-testid="trace-bar"]')).toHaveLength(4);
    expect(container.querySelector('[data-testid="trace-event-agent"] [data-testid="trace-bar"]')).toBeNull();
  });

  it("shows the elapsed Run duration of an active Run", async () => {
    useQueryMock.mockReturnValue({ _id: "run-1", status: "running", createdAt: Date.now() - 125_000 });
    transcriptMock.mockResolvedValue({ found: true, turns: [] });
    await render();
    expect(container.querySelector('[data-testid="trace-summary"]')!.textContent).toMatch(/Run duration\s*2 min/);
  });

  it("shows an empty state, not an error, for a Run with no session yet", async () => {
    useQueryMock.mockReturnValue({ _id: "run-1", status: "pending", createdAt: 0 });
    await render();
    expect(container.textContent).toContain("No trace yet");
    expect(transcriptMock).not.toHaveBeenCalled();
  });
});
