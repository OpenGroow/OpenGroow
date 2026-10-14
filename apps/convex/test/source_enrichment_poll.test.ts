import { describe, expect, it } from "vitest";
import { decideSourceEnrichmentPoll } from "../mission_dispatcher/external_job_polling.js";

// Issue #533: Source enrichment shares the polling engine with Mission
// External Jobs; only the meaning of a terminal state differs.
describe("decideSourceEnrichmentPoll", () => {
  const CORE = {
    server: "analysis-mcp",
    mcpTool: "get_analyze_reel_status",
    statusField: "status",
    outputIsRoot: true,
    terminalStates: { completed: ["completed"], failed: ["failed"] },
    unavailableErrorCodes: ["reel_unavailable", "reel_private"],
  };
  const decide = (
    job: { status: string; error?: string; output?: Record<string, unknown> },
    timedOut = false,
  ) => decideSourceEnrichmentPoll(job, CORE, { maxMs: 60_000 }, timedOut);

  it("waits while the job is still running", () => {
    expect(decide({ status: "running" })).toEqual({ type: "wait" });
  });

  it("hands the completed output back", () => {
    expect(decide({ status: "completed", output: { observation: { hook: "x" } } })).toEqual({
      type: "completed",
      output: { observation: { hook: "x" } },
    });
  });

  it("maps a declared-failed job to a retryable failed Source", () => {
    expect(decide({ status: "failed", error: "boom", output: { errorCode: "internal" } })).toEqual({
      type: "failed",
      sourceStatus: "failed",
      message: "boom",
    });
  });

  it("maps a declared unavailable error code to an unavailable Source", () => {
    expect(decide({ status: "failed", error: "private", output: { errorCode: "reel_private" } })).toEqual({
      type: "failed",
      sourceStatus: "unavailable",
      message: "private",
    });
  });

  it("maps a completed job with an empty result to an unavailable Source", () => {
    expect(decide({ status: "completed" })).toMatchObject({ type: "failed", sourceStatus: "unavailable" });
    expect(decide({ status: "completed", output: {} })).toMatchObject({ type: "failed", sourceStatus: "unavailable" });
  });

  it("fails a malformed status and a timed-out job as retryable", () => {
    expect(decide({ status: "" })).toMatchObject({ type: "failed", sourceStatus: "failed" });
    expect(decide({ status: "running" }, true)).toMatchObject({ type: "failed", sourceStatus: "failed" });
  });
});
