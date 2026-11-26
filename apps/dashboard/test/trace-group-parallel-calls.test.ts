import { describe, expect, it } from "vitest";
import { groupParallelCalls, normalizeTrace } from "../src/lib/trace/normalize-trace";

const ts = (ms: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, ms)).toISOString();
const run = { id: "run-1", status: "completed" };
const call = (id: string, tool: string, at: number) => ({ kind: "tool_call" as const, toolName: tool, toolCallId: id, arguments: { id }, timestamp: ts(at) });
const result = (id: string, tool: string, at: number, success = true) => ({ kind: "tool_result" as const, toolName: tool, toolCallId: id, success, result: `r-${id}`, timestamp: ts(at) });

describe("groupParallelCalls", () => {
  it("makes one event of calls of the same tool started together, spanning from the first start to the last end", () => {
    const events = groupParallelCalls(
      normalizeTrace(
        [call("a", "demo__schema", 0), call("b", "demo__schema", 0), result("a", "demo__schema", 50), result("b", "demo__schema", 65)],
        run,
      ),
    );
    expect(events).toHaveLength(1);
    const group = events[0]!;
    expect(group).toMatchObject({ type: "tool", name: "schema", server: "demo", status: "completed", startedAt: ts(0), endedAt: ts(65), observedDurationMs: 65 });
    expect(group.type === "tool" && group.calls?.map((c) => c.toolCallId)).toEqual(["a", "b"]);
    expect(group.type === "tool" && group.calls?.map((c) => c.output)).toEqual(["r-a", "r-b"]);
  });

  it("leaves a lone call, calls of different tools and calls started at different times as they are", () => {
    const events = groupParallelCalls(
      normalizeTrace(
        [call("a", "demo__schema", 0), call("b", "demo__ping", 0), result("a", "demo__schema", 10), result("b", "demo__ping", 10), call("c", "demo__ping", 20), result("c", "demo__ping", 30)],
        run,
      ),
    );
    expect(events).toHaveLength(3);
    expect(events.every((event) => event.type === "tool" && event.calls === undefined)).toBe(true);
  });

  it("is failed when one of the parallel calls failed, and running while one has no result", () => {
    const failed = groupParallelCalls(normalizeTrace([call("a", "x", 0), call("b", "x", 0), result("a", "x", 5), result("b", "x", 6, false)], run))[0]!;
    expect(failed).toMatchObject({ status: "failed", error: "r-b" });
    const live = groupParallelCalls(normalizeTrace([call("a", "x", 0), call("b", "x", 0), result("a", "x", 5)], { id: "run-1", status: "running" }))[0]!;
    expect(live).toMatchObject({ status: "running" });
    expect(live.type === "tool" && live.endedAt).toBeUndefined();
  });

  it("does not group across a message", () => {
    const events = groupParallelCalls(
      normalizeTrace([call("a", "x", 0), { kind: "message", role: "assistant", text: "hi", timestamp: ts(0) }, call("b", "x", 0)], run),
    );
    expect(events).toHaveLength(3);
  });
});
