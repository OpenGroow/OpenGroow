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

describe("Tool inspector", () => {
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

  it("shows input, output, metadata and error of the selected Tool Call", async () => {
    useQueryMock.mockReturnValue({ _id: "run-1", status: "completed", createdAt: 0, completedAt: 9000 });
    transcriptMock.mockResolvedValue({
      found: true,
      turns: [
        { kind: "tool_call", toolName: "media.generate", toolCallId: "c1", arguments: { prompt: "hello" }, timestamp: ts(1) },
        { kind: "tool_result", toolName: "media.generate", toolCallId: "c1", success: true, result: "all good", timestamp: ts(3) },
        { kind: "tool_call", toolName: "media.fail", toolCallId: "c2", arguments: { n: 2 }, timestamp: ts(4) },
        { kind: "tool_result", toolName: "media.fail", toolCallId: "c2", success: false, result: "boom detail", timestamp: ts(5) },
      ],
    });
    await act(async () => {
      root.render(
        <React.Suspense fallback={null}>
          <RunTraceView params={params} runId={"run-1" as never} />
        </React.Suspense>,
      );
    });
    await act(async () => {});
    expect(container.querySelector('[data-testid="tool-inspector"]')).toBeNull();

    const buttons = container.querySelectorAll<HTMLButtonElement>('[data-testid="trace-event-tool"] button');
    await act(async () => buttons[0].click());
    const inspector = () => container.querySelector('[data-testid="tool-inspector"]')!;
    expect(inspector().textContent).toContain('"prompt": "hello"');

    // The call and its result are shown together: no tab to switch.
    expect(inspector().querySelector('[role="tab"]')).toBeNull();
    expect(inspector().querySelector('[aria-label="Input"]')!.textContent).toContain('"prompt": "hello"');
    expect(inspector().querySelector('[aria-label="Output"]')!.textContent).toContain("all good");
    expect(inspector().querySelector('[aria-label="Completed"]')).not.toBeNull();
    expect(inspector().textContent).toContain("c1");
    expect(inspector().textContent).toContain("2.0 s");

    await act(async () => buttons[1].click());
    expect(inspector().textContent).toContain("fail");
    expect(inspector().textContent).toContain("boom detail");
  });

  it("shows parallel calls of the same tool as one row, and each call in its inspector", async () => {
    useQueryMock.mockReturnValue({ _id: "run-1", status: "completed", createdAt: 0, completedAt: 9000 });
    transcriptMock.mockResolvedValue({
      found: true,
      turns: [
        { kind: "tool_call", toolName: "demo__schema", toolCallId: "c1", arguments: { n: 1 }, timestamp: ts(1) },
        { kind: "tool_call", toolName: "demo__schema", toolCallId: "c2", arguments: { n: 2 }, timestamp: ts(1) },
        { kind: "tool_result", toolName: "demo__schema", toolCallId: "c1", success: true, result: "first result", timestamp: ts(2) },
        { kind: "tool_result", toolName: "demo__schema", toolCallId: "c2", success: true, result: "second result", timestamp: ts(2) },
      ],
    });
    await act(async () => {
      root.render(
        <React.Suspense fallback={null}>
          <RunTraceView params={params} runId={"run-1" as never} />
        </React.Suspense>,
      );
    });
    await act(async () => {});
    const rows = container.querySelectorAll('[data-testid="trace-event-tool"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.querySelector('[data-testid="parallel-calls"]')!.textContent).toBe("×2");
    await act(async () => rows[0]!.querySelector("button")!.click());
    const inspector = container.querySelector('[data-testid="tool-inspector"]')!;
    expect(inspector.querySelectorAll('[aria-label^="Call "]')).toHaveLength(2);
    expect(inspector.textContent).toContain("first result");
    expect(inspector.textContent).toContain("second result");
    expect(inspector.textContent).toContain("×2");
  });

  it("copies the payload", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    useQueryMock.mockReturnValue({ _id: "run-1", status: "completed", createdAt: 0, completedAt: 9000 });
    transcriptMock.mockResolvedValue({
      found: true,
      turns: [{ kind: "tool_call", toolName: "read", toolCallId: "c1", arguments: { a: 1 }, timestamp: ts(1) }],
    });
    await act(async () => {
      root.render(
        <React.Suspense fallback={null}>
          <RunTraceView params={params} runId={"run-1" as never} />
        </React.Suspense>,
      );
    });
    await act(async () => {});
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="trace-event-tool"] button')!.click());
    const copy = [...container.querySelectorAll<HTMLButtonElement>('[data-testid="tool-inspector"] button')].find(
      (b) => b.textContent === "Copy",
    )!;
    await act(async () => copy.click());
    expect(writeText).toHaveBeenCalledWith(JSON.stringify({ a: 1 }, null, 2));
  });

  it("opens the full text of an Instruction or Agent message", async () => {
    const long = "I'll start by reading the run notes. ".repeat(10).trim();
    useQueryMock.mockReturnValue({ _id: "run-1", status: "completed", createdAt: 0, completedAt: 9000 });
    transcriptMock.mockResolvedValue({
      found: true,
      turns: [
        { kind: "message", role: "user", text: "Read missions/abc and report", timestamp: ts(1) },
        { kind: "message", role: "assistant", text: long, timestamp: ts(2) },
      ],
    });
    await act(async () => {
      root.render(
        <React.Suspense fallback={null}>
          <RunTraceView params={params} runId={"run-1" as never} />
        </React.Suspense>,
      );
    });
    await act(async () => {});
    const inspector = () => container.querySelector('[data-testid="tool-inspector"]')!;
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="trace-event-agent"] button')!.click());
    expect(inspector().textContent).toContain(long);
    expect(inspector().textContent).toContain("Agent");
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="trace-event-instruction"] button')!.click());
    expect(inspector().textContent).toContain("Read missions/abc and report");
  });
});
