import { describe, expect, it } from "vitest";
import { normalizeTrace, splitToolName, summarizeTrace } from "../src/lib/trace/normalize-trace";
import type { SessionTranscriptTurn } from "../src/components/workspace-logs.types";

const t = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
const call = (toolName: string, toolCallId: string | undefined, s?: number, args: unknown = {}): SessionTranscriptTurn => ({
  kind: "tool_call",
  toolName,
  toolCallId,
  arguments: args,
  ...(s === undefined ? {} : { timestamp: t(s) }),
});
const result = (
  toolName: string,
  toolCallId: string | undefined,
  s?: number,
  success = true,
  res: unknown = "ok",
): SessionTranscriptTurn => ({
  kind: "tool_result",
  toolName,
  toolCallId,
  success,
  result: res,
  ...(s === undefined ? {} : { timestamp: t(s) }),
});
const run = (status: string) => ({ id: "run-1", status });
const tools = (events: ReturnType<typeof normalizeTrace>) => events.filter((e) => e.type === "tool");

describe("normalizeTrace", () => {
  it("groups a call and its result through toolCallId with the Observed duration", () => {
    const events = normalizeTrace([call("media.generate", "c1", 1, { a: 1 }), result("media.generate", "c1", 4, true, "done")], run("completed"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "tool",
      name: "generate",
      server: "media",
      toolCallId: "c1",
      status: "completed",
      observedDurationMs: 3000,
      input: { a: 1 },
      output: "done",
    });
  });

  it("pairs parallel calls of the same tool whose results arrive in another order", () => {
    const events = normalizeTrace(
      [call("read", "a", 1, "A"), call("read", "b", 1, "B"), result("read", "b", 3, true, "rb"), result("read", "a", 5, true, "ra")],
      run("completed"),
    );
    expect(events.map((e) => [e.type === "tool" && e.input, e.type === "tool" && e.output, e.type === "tool" && e.observedDurationMs])).toEqual([
      ["A", "ra", 4000],
      ["B", "rb", 2000],
    ]);
  });

  it("keeps an unmatched result alone as unknown", () => {
    const events = normalizeTrace([result("read", "zz", 2)], run("completed"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "tool", status: "unknown", toolCallId: "zz" });
    expect(events[0]).not.toHaveProperty("observedDurationMs");
  });

  it("marks a call without result running on an active Run and unknown on a terminal Run", () => {
    expect(tools(normalizeTrace([call("read", "a", 1)], run("running")))[0]).toMatchObject({ status: "running" });
    for (const status of ["completed", "failed", "cancelled", "resumed"]) {
      expect(tools(normalizeTrace([call("read", "a", 1)], run(status)))[0]).toMatchObject({ status: "unknown" });
    }
  });

  it("marks an error result failed", () => {
    const [e] = normalizeTrace([call("read", "a", 1), result("read", "a", 2, false, "boom")], run("completed"));
    expect(e).toMatchObject({ status: "failed", error: "boom" });
  });

  it("preserves transcript order across kinds", () => {
    const events = normalizeTrace(
      [
        { kind: "message", role: "user", text: "do it", timestamp: t(0) },
        call("read", "a", 1),
        { kind: "message", role: "assistant", text: "hi", timestamp: t(2) },
        result("read", "a", 3),
      ],
      run("completed"),
    );
    expect(events.map((e) => e.type)).toEqual(["instruction", "tool", "agent"]);
    expect(events.map((e) => e.id)).toEqual(["run-1:0", "run-1:1", "run-1:2"]);
  });

  it("gives no duration when a timestamp is missing", () => {
    const [a] = normalizeTrace([call("read", "a"), result("read", "a", 3)], run("completed"));
    const [b] = normalizeTrace([call("read", "a", 1), result("read", "a")], run("completed"));
    expect(a).toMatchObject({ status: "completed", observedDurationMs: undefined });
    expect(b).toMatchObject({ status: "completed", observedDurationMs: undefined });
  });

  it("groups nothing by guess without toolCallId", () => {
    const events = normalizeTrace([call("read", undefined, 1), result("read", undefined, 2)], run("completed"));
    expect(events).toHaveLength(2);
    expect(events.map((e) => (e.type === "tool" ? e.status : null))).toEqual(["unknown", "unknown"]);
  });

  it("does not flag an External Job handoff on its own", () => {
    const [e] = normalizeTrace([call("media.generate", "c1", 1), result("media.generate", "c1", 2)], run("completed"));
    expect(e).toMatchObject({ externalJobHandoff: false });
  });
});

describe("splitToolName", () => {
  it("splits prefixed names and leaves file tools without server", () => {
    expect(splitToolName("media.generate")).toEqual({ server: "media", name: "generate" });
    expect(splitToolName("media-mcp__generate_assets")).toEqual({ server: "media-mcp", name: "generate_assets" });
    expect(splitToolName("read")).toEqual({ name: "read" });
    expect(splitToolName("write")).toEqual({ name: "write" });
  });
});

describe("summarizeTrace", () => {
  it("counts Tool Calls and failures", () => {
    const events = normalizeTrace(
      [call("a", "1", 1), result("a", "1", 2), call("b", "2", 2), result("b", "2", 3, false), { kind: "message", role: "user", text: "x" }],
      run("completed"),
    );
    expect(summarizeTrace(events)).toEqual({ toolCallCount: 2, failedToolCallCount: 1 });
  });
});

describe("External Job handoff", () => {
  const mcpJob = { serverName: "media-mcp", jobId: "job-42", jobType: "create_video" };
  const started = JSON.stringify({ status: "started", jobId: "job-42" });
  const turns = (out: unknown) => [call("media-mcp__create_video", "c1", 1), result("media-mcp__create_video", "c1", 2, true, out)];

  it("labels the matching Tool Call and keeps it completed", () => {
    const [e] = tools(normalizeTrace(turns(started), { ...run("awaiting_job"), mcpJob }));
    expect(e).toMatchObject({ status: "completed", externalJobHandoff: true });
  });

  it("matches an object output carrying the job id", () => {
    const [e] = tools(normalizeTrace(turns({ status: "started", jobId: "job-42" }), { ...run("awaiting_job"), mcpJob }));
    expect(e).toMatchObject({ externalJobHandoff: true });
  });

  it("leaves a started reply that does not match the Run's mcpJob as a plain Tool Call", () => {
    const other = JSON.stringify({ status: "started", jobId: "job-7" });
    expect(tools(normalizeTrace(turns(other), { ...run("awaiting_job"), mcpJob }))[0]).toMatchObject({ externalJobHandoff: false });
    const wrongTool = [call("media-mcp__other", "c1", 1), result("media-mcp__other", "c1", 2, true, started)];
    expect(tools(normalizeTrace(wrongTool, { ...run("awaiting_job"), mcpJob }))[0]).toMatchObject({ externalJobHandoff: false });
    const wrongServer = [call("x__create_video", "c1", 1), result("x__create_video", "c1", 2, true, started)];
    expect(tools(normalizeTrace(wrongServer, { ...run("awaiting_job"), mcpJob }))[0]).toMatchObject({ externalJobHandoff: false });
  });

  it("still shows the handoff once the Run is completed", () => {
    expect(tools(normalizeTrace(turns(started), { ...run("completed"), mcpJob }))[0]).toMatchObject({ externalJobHandoff: true });
  });

  it("flags nothing for a legacy mcpJob without a usable tool name", () => {
    for (const jobType of [undefined, "legacy", ""]) {
      const legacy = { ...mcpJob, jobType };
      expect(tools(normalizeTrace(turns(started), { ...run("awaiting_job"), mcpJob: legacy }))[0]).toMatchObject({ externalJobHandoff: false });
    }
  });
});
