/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRunTranscript, type RunTranscriptState } from "../src/components/trace/use-run-transcript";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const transcriptMock = vi.fn();

vi.mock("convex/react", () => ({ useAction: () => transcriptMock }));
vi.mock("@convex/_generated/api", () => ({
  api: { workspace_logs_node: { getWorkspaceRunTranscript: "x" } },
}));

let latest: RunTranscriptState;
function Probe({ runStatus }: { runStatus: string }) {
  latest = useRunTranscript({ instanceId: "i", workspaceKey: "w", runId: "r" as never, enabled: true, runStatus });
  return null;
}

const turn = (text: string) => ({ kind: "message", role: "assistant", text }) as never;
const ok = (n: number) => ({ found: true, turns: Array.from({ length: n }, (_, i) => turn(`t${i}`)) });

let root: Root;
let mounted: boolean;
beforeEach(() => {
  vi.useFakeTimers();
  transcriptMock.mockReset();
  root = createRoot(document.createElement("div"));
  mounted = true;
});
afterEach(() => {
  if (mounted) act(() => root.unmount());
  vi.useRealTimers();
});

const render = (runStatus: string) => act(async () => root.render(<Probe runStatus={runStatus} />));
const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const turnsCount = () => (latest.status === "data" ? latest.turns.length : -1);

describe("useRunTranscript polling", () => {
  it("reads a terminal Run once, without polling", async () => {
    transcriptMock.mockResolvedValue(ok(1));
    await render("completed");
    await tick(10_000);
    expect(transcriptMock).toHaveBeenCalledTimes(1);
  });

  it("polls an active Run and shows new events", async () => {
    transcriptMock.mockResolvedValueOnce(ok(1)).mockResolvedValue(ok(2));
    await render("running");
    expect(turnsCount()).toBe(1);
    await tick(3000);
    expect(turnsCount()).toBe(2);
  });

  it("never has two reads in flight", async () => {
    let inFlight = 0;
    let max = 0;
    transcriptMock.mockImplementation(async () => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 8000));
      inFlight--;
      return ok(1);
    });
    await render("running");
    await tick(30_000);
    expect(max).toBe(1);
    expect(transcriptMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("makes one final read when the Run becomes terminal, then stops", async () => {
    transcriptMock.mockResolvedValue(ok(1));
    await render("running");
    await render("completed");
    await tick(3000);
    const afterFinal = transcriptMock.mock.calls.length;
    await tick(15_000);
    expect(transcriptMock.mock.calls.length).toBe(afterFinal);
    expect(afterFinal).toBeGreaterThanOrEqual(2);
  });

  it("stops polling when unmounted", async () => {
    transcriptMock.mockResolvedValue(ok(1));
    await render("running");
    act(() => root.unmount());
    mounted = false;
    const calls = transcriptMock.mock.calls.length;
    await tick(10_000);
    expect(transcriptMock.mock.calls.length).toBe(calls);
  });

  it("keeps the last Trace on a failed poll, flags it, and clears on success", async () => {
    transcriptMock.mockResolvedValueOnce(ok(2)).mockRejectedValueOnce(new Error("boom")).mockResolvedValue(ok(3));
    await render("running");
    await tick(3000);
    expect(latest).toMatchObject({ status: "data", pollError: "boom" });
    expect(turnsCount()).toBe(2);
    await tick(3000);
    expect(turnsCount()).toBe(3);
    expect((latest as { pollError?: string }).pollError).toBeUndefined();
  });
});
