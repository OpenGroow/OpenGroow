import { describe, expect, it } from "vitest";
import { decideReconciliation, type ReconcileSnapshot } from "../mission_dispatcher/reconciliation.js";
import type { Id } from "../_generated/dataModel";

const MISSION_ID = "mission-abc" as Id<"missions">;
const RUN_ID = "run-xyz" as Id<"runs">;
const READ_COMMAND_ID = "cmd-read" as Id<"commands">;
const MISSION_PARENT = { kind: "mission", missionId: MISSION_ID } as const;
const SOURCE_JOB_PARENT = { kind: "job", jobId: "job-abc" as Id<"jobs"> } as const;
const CTX = { parent: MISSION_PARENT, runId: RUN_ID, missionType: "create_article", retryableFailureCount: 0 };
const SOCIAL_CTX = { parent: MISSION_PARENT, runId: RUN_ID, missionType: "engage", retryableFailureCount: 0 };

const BASE_SNAPSHOT: ReconcileSnapshot = {
  execResult: null,
  resultReadCommandId: null,
  readResult: null,
  workspaceKey: "ws-1",
  timedOut: false,
  salvageTimedOut: false,
  finalReadCommandId: null,
  finalReadResult: null,
  maxMs: 60_000,
};

describe("decideReconciliation", () => {
  it("waits when there is no exec result yet and the run hasn't timed out", () => {
    expect(decideReconciliation(BASE_SNAPSHOT, CTX)).toEqual({ type: "wait" });
  });

  it("attempts a salvage read instead of failing immediately when timed out with no exec result", () => {
    // The exec's completion signal never arrived (e.g. the underlying process hung after
    // finishing its work) — before giving up, try reading the workspace in case the Agent
    // already wrote a valid RunResult.
    const decision = decideReconciliation({ ...BASE_SNAPSHOT, timedOut: true }, CTX);
    expect(decision).toEqual({
      type: "enqueueRead",
      role: "result",
      filePath: `missions/${MISSION_ID}/outputs/${RUN_ID}.json`,
    });
  });

  it("waits while the salvage read is in flight and hasn't hit its own grace period yet", () => {
    const decision = decideReconciliation(
      { ...BASE_SNAPSHOT, timedOut: true, resultReadCommandId: READ_COMMAND_ID },
      CTX,
    );
    expect(decision).toEqual({ type: "wait" });
  });

  it("fails with timeout when the salvage read itself never resolves within its grace period", () => {
    const decision = decideReconciliation(
      { ...BASE_SNAPSHOT, timedOut: true, resultReadCommandId: READ_COMMAND_ID, salvageTimedOut: true },
      CTX,
    );
    expect(decision).toEqual({ type: "markFailed", code: "timeout", message: "Run exceeded 60000 ms" });
  });

  it("completes the run when the salvage read finds a valid RunResult already written to the workspace", () => {
    // The Agent finished and wrote a valid RunResult before its process got stuck — the salvage
    // read must recover it as a genuine success, not throw it away as a timeout failure.
    const decision = decideReconciliation(
      {
        ...BASE_SNAPSHOT,
        timedOut: true,
        resultReadCommandId: READ_COMMAND_ID,
        readResult: { ok: true, data: { content: JSON.stringify({ status: "success", summary: "ok" }) } },
      },
      CTX,
    );
    expect(decision).toEqual({
      type: "markCompleted",
      result: { status: "success", summary: "ok" },
    });
  });

  it("retries the salvage read when it resolves to not-found but the grace period hasn't elapsed", () => {
    // Live incident: the openclaw-agent OS process was still genuinely running (not hung) well
    // past the Run's own maxMs — a resolved ENOENT this early just means the Agent hasn't
    // written its result yet, not that it never will. Failing immediately here is exactly the
    // "marked failed while still running" bug — retry instead, bounded by salvageTimedOut below.
    const decision = decideReconciliation(
      {
        ...BASE_SNAPSHOT,
        timedOut: true,
        resultReadCommandId: READ_COMMAND_ID,
        readResult: { ok: false, error: "ENOENT" },
      },
      CTX,
    );
    expect(decision).toEqual({
      type: "enqueueRead",
      role: "result",
      filePath: `missions/${MISSION_ID}/outputs/${RUN_ID}.json`,
    });
  });

  it("requests one final read when the salvage grace period elapses on a stale not-found, instead of failing immediately", () => {
    // Live incident: the cached not-found readResult can straddle the exact instant
    // salvageTimedOut flips true — the Agent's output file can still land moments later.
    // Give it exactly one more, final, fresh read before concluding failure.
    const decision = decideReconciliation(
      {
        ...BASE_SNAPSHOT,
        timedOut: true,
        salvageTimedOut: true,
        resultReadCommandId: READ_COMMAND_ID,
        readResult: { ok: false, error: "ENOENT" },
      },
      CTX,
    );
    expect(decision).toEqual({
      type: "enqueueRead",
      role: "final",
      filePath: `missions/${MISSION_ID}/outputs/${RUN_ID}.json`,
    });
  });

  it("fails with file_missing once the final last-chance read also resolves to not-found", () => {
    // Distinguishes a genuinely lost run (file never existed even after the final read) from
    // the retry case above — only now do we stop giving the Agent the benefit of the doubt.
    const decision = decideReconciliation(
      {
        ...BASE_SNAPSHOT,
        timedOut: true,
        salvageTimedOut: true,
        resultReadCommandId: READ_COMMAND_ID,
        readResult: { ok: false, error: "ENOENT" },
        finalReadCommandId: READ_COMMAND_ID,
        finalReadResult: { ok: false, error: "ENOENT" },
      },
      CTX,
    );
    expect(decision).toMatchObject({ type: "markFailed", code: "file_missing" });
  });

  it("waits while the final last-chance read is still in flight", () => {
    const decision = decideReconciliation(
      {
        ...BASE_SNAPSHOT,
        timedOut: true,
        salvageTimedOut: true,
        resultReadCommandId: READ_COMMAND_ID,
        readResult: { ok: false, error: "ENOENT" },
        finalReadCommandId: READ_COMMAND_ID,
        finalReadResult: null,
      },
      CTX,
    );
    expect(decision).toEqual({ type: "wait" });
  });

  it("recovers the run as completed when the final last-chance read finds the valid RunResult that just landed", () => {
    // This is the exact race from the k97ejvep5pvrthwygzk6tde3b98az5bb incident: the Agent's
    // output file appeared a few seconds after the cached not-found was taken, right at the
    // grace-period boundary.
    const decision = decideReconciliation(
      {
        ...BASE_SNAPSHOT,
        timedOut: true,
        salvageTimedOut: true,
        resultReadCommandId: READ_COMMAND_ID,
        readResult: { ok: false, error: "ENOENT" },
        finalReadCommandId: READ_COMMAND_ID,
        finalReadResult: { ok: true, data: { content: JSON.stringify({ status: "success", summary: "ok" }) } },
      },
      CTX,
    );
    expect(decision).toEqual({
      type: "markCompleted",
      result: { status: "success", summary: "ok" },
    });
  });

  it("fails with runtime when the exec result is ok=false", () => {
    const decision = decideReconciliation(
      { ...BASE_SNAPSHOT, execResult: { ok: false, error: "boom" } },
      CTX,
    );
    expect(decision).toEqual({ type: "markFailed", code: "runtime", message: "boom" });
  });

  it("enqueues a read on the canonical outputs path when exec succeeded and no read is dispatched yet", () => {
    const decision = decideReconciliation({ ...BASE_SNAPSHOT, execResult: { ok: true } }, CTX);
    expect(decision).toEqual({
      type: "enqueueRead",
      role: "result",
      filePath: `missions/${MISSION_ID}/outputs/${RUN_ID}.json`,
    });
  });

  it("fails with dispatch_inputs_missing when exec succeeded but workspaceKey is missing", () => {
    const decision = decideReconciliation(
      { ...BASE_SNAPSHOT, execResult: { ok: true }, workspaceKey: null },
      CTX,
    );
    expect(decision.type).toBe("markFailed");
    expect(decision).toMatchObject({ code: "dispatch_inputs_missing" });
  });

  it("waits when the read has been dispatched but no read result has arrived yet", () => {
    const decision = decideReconciliation(
      { ...BASE_SNAPSHOT, execResult: { ok: true }, resultReadCommandId: READ_COMMAND_ID },
      CTX,
    );
    expect(decision).toEqual({ type: "wait" });
  });

  it("fails with file_missing when the read result is ok=false", () => {
    const decision = decideReconciliation(
      {
        ...BASE_SNAPSHOT,
        execResult: { ok: true },
        resultReadCommandId: READ_COMMAND_ID,
        readResult: { ok: false, error: "ENOENT" },
      },
      CTX,
    );
    expect(decision).toMatchObject({ type: "markFailed", code: "file_missing" });
  });

  it("asks the agent to retry with the parse error when the read content is not valid JSON and the retry budget isn't exhausted", () => {
    const decision = decideReconciliation(
      {
        ...BASE_SNAPSHOT,
        execResult: { ok: true },
        resultReadCommandId: READ_COMMAND_ID,
        readResult: { ok: true, data: { content: "{not json" } },
      },
      CTX,
    );
    expect(decision).toMatchObject({ type: "markFailedRetryable", jobType: undefined });
    expect((decision as { error: string }).error).toContain("JSON");
  });

  it("fails permanently once the invalid-output retry budget is exhausted", () => {
    const decision = decideReconciliation(
      {
        ...BASE_SNAPSHOT,
        execResult: { ok: true },
        resultReadCommandId: READ_COMMAND_ID,
        readResult: { ok: true, data: { content: "{not json" } },
      },
      { ...CTX, retryableFailureCount: 3 },
    );
    expect(decision).toMatchObject({ type: "markFailed", code: "file_invalid" });
  });

  it("fails a SourceJob's Run at once on invalid output, since no Mission can resume", () => {
    const decision = decideReconciliation(
      {
        ...BASE_SNAPSHOT,
        execResult: { ok: true },
        resultReadCommandId: READ_COMMAND_ID,
        readResult: { ok: true, data: { content: "{not json" } },
      },
      { ...CTX, parent: SOURCE_JOB_PARENT, sourceIngestion: true },
    );
    expect(decision).toMatchObject({ type: "markFailed", code: "file_invalid" });
  });

  it("asks the agent to retry when the JSON doesn't match the RunResult schema", () => {
    const decision = decideReconciliation(
      {
        ...BASE_SNAPSHOT,
        execResult: { ok: true },
        resultReadCommandId: READ_COMMAND_ID,
        readResult: { ok: true, data: { content: JSON.stringify({ status: "success" }) } }, // missing summary
      },
      CTX,
    );
    expect(decision).toMatchObject({ type: "markFailedRetryable", jobType: undefined });
    expect((decision as { error: string }).error).toContain("missing summary");
  });

  it("rejects a failed RunResult missing the required `summary`, even when `error.message` could stand in for it", () => {
    // No more silent promotion of error.message into summary — the Agent must write a
    // schema-conforming RunResult; a fresh Run gets the exact validation error to fix.
    const decision = decideReconciliation(
      {
        ...BASE_SNAPSHOT,
        execResult: { ok: true },
        resultReadCommandId: READ_COMMAND_ID,
        readResult: {
          ok: true,
          data: {
            content: JSON.stringify({
              status: "failed",
              error: { code: "device_node_unavailable", message: "Device command routing failed." },
            }),
          },
        },
      },
      CTX,
    );
    expect(decision).toMatchObject({ type: "markFailedRetryable", jobType: undefined });
    expect((decision as { error: string }).error).toContain("missing summary");
  });

  it("parks the run as markAwaitingJob when the RunResult is a non-terminal in_progress pointer", () => {
    const decision = decideReconciliation(
      {
        ...BASE_SNAPSHOT,
        execResult: { ok: true },
        resultReadCommandId: READ_COMMAND_ID,
        readResult: {
          ok: true,
          data: {
            content: JSON.stringify({
              status: "in_progress",
              summary: "Rendering…",
              reviewQuestions: ["Ready?"],
              job: { mcpServer: "video-mcp", jobId: "render-1", jobType: "produce_video" },
            }),
          },
        },
      },
      CTX,
    );
    expect(decision).toEqual({
      type: "markAwaitingJob",
      job: {
        serverName: "video-mcp",
        jobId: "render-1",
        summary: "Rendering…",
        reviewQuestions: ["Ready?"],
        jobType: "produce_video",
        missionType: "create_article",
      },
    });
  });

  it("completes the run when the RunResult is a valid terminal success", () => {
    const decision = decideReconciliation(
      {
        ...BASE_SNAPSHOT,
        execResult: { ok: true },
        resultReadCommandId: READ_COMMAND_ID,
        readResult: { ok: true, data: { content: JSON.stringify({ status: "success", summary: "ok" }) } },
      },
      CTX,
    );
    expect(decision).toEqual({
      type: "markCompleted",
      result: { status: "success", summary: "ok" },
    });
  });

  it("rejects the legacy Social Engagement `completed` status instead of translating it to success", () => {
    // Pre-#323 Social Engagement Agents wrote `status: "completed"` plus legacy
    // sessionStats/commentStats fields. No more per-Template translation shims — an
    // out-of-date Template must be republished, not silently patched around here.
    const decision = decideReconciliation(
      {
        ...BASE_SNAPSHOT,
        execResult: { ok: true },
        resultReadCommandId: READ_COMMAND_ID,
        readResult: {
          ok: true,
          data: {
            content: JSON.stringify({
              status: "completed",
              summary: "Session completed after 11 posts.",
              sessionStats: { totalSeen: 11, liked: 4, skipped: 6 },
              commentStats: { totalCommentsPosted: 1 },
            }),
          },
        },
      },
      SOCIAL_CTX,
    );

    expect(decision).toMatchObject({ type: "markFailedRetryable", jobType: undefined });
  });

  it("rejects a success result carrying legacy postsProcessed/reportPath fields instead of accepting them", () => {
    const decision = decideReconciliation(
      {
        ...BASE_SNAPSHOT,
        execResult: { ok: true },
        resultReadCommandId: READ_COMMAND_ID,
        readResult: {
          ok: true,
          data: {
            content: JSON.stringify({
              status: "success",
              summary: "Session complete after 3 posts.",
              postsProcessed: 3,
              reportPath: `missions/${MISSION_ID}/artifacts/${RUN_ID}/report.json`,
            }),
          },
        },
      },
      SOCIAL_CTX,
    );

    expect(decision).toMatchObject({ type: "markFailedRetryable", jobType: undefined });
    expect((decision as { error: string }).error).toContain("unexpected postsProcessed, reportPath");
  });

  it("rejects a summary written as an object instead of coercing it to a string", () => {
    const decision = decideReconciliation(
      {
        ...BASE_SNAPSHOT,
        execResult: { ok: true },
        resultReadCommandId: READ_COMMAND_ID,
        readResult: {
          ok: true,
          data: {
            content: JSON.stringify({
              status: "success",
              summary: { text: "Session complete after 5 posts." },
            }),
          },
        },
      },
      CTX,
    );

    expect(decision).toMatchObject({ type: "markFailedRetryable", jobType: undefined });
  });

  it("rejects arbitrary top-level result fields instead of merging them into additionalDetails", () => {
    const decision = decideReconciliation(
      {
        ...BASE_SNAPSHOT,
        execResult: { ok: true },
        resultReadCommandId: READ_COMMAND_ID,
        readResult: {
          ok: true,
          data: {
            content: JSON.stringify({
              status: "success",
              summary: "Completed.",
              customMetric: 42,
            }),
          },
        },
      },
      CTX,
    );

    expect(decision).toMatchObject({ type: "markFailedRetryable", jobType: undefined });
    expect((decision as { error: string }).error).toContain("unexpected customMetric");
  });

  it("rejects a mistyped additionalDetails alongside other extra fields, asking the agent to fix it (mission js7eaay07crzjmm4xnk7qgh9ws8efhd0)", () => {
    // Live incident: the Agent wrote `additionalDetails` as a plain string instead of an
    // object, alongside unrecognized top-level fields (`reportPath`, `stats`, `sessionState`).
    // No more Convex-side repair for either problem — the exact schema error goes back to the
    // Agent (via context.md on the next Run) so it fixes its own output.
    const decision = decideReconciliation(
      {
        ...BASE_SNAPSHOT,
        execResult: { ok: true },
        resultReadCommandId: READ_COMMAND_ID,
        readResult: {
          ok: true,
          data: {
            content: JSON.stringify({
              status: "success",
              summary: "Completed.",
              additionalDetails: "see report",
              reportPath: "report.json",
              stats: { seen: 3 },
              sessionState: "done",
            }),
          },
        },
      },
      CTX,
    );

    expect(decision).toMatchObject({ type: "markFailedRetryable", jobType: undefined });
    expect((decision as { error: string }).error).toContain(
      "unexpected reportPath, stats, sessionState; additionalDetails should be object (got string)",
    );
  });

  it("does not relax the completed status for other Mission types", () => {
    const decision = decideReconciliation(
      {
        ...BASE_SNAPSHOT,
        execResult: { ok: true },
        resultReadCommandId: READ_COMMAND_ID,
        readResult: {
          ok: true,
          data: {
            content: JSON.stringify({
              status: "completed",
              summary: "done",
              sessionStats: { totalSeen: 1 },
            }),
          },
        },
      },
      CTX,
    );

    expect(decision).toMatchObject({ type: "markFailedRetryable", jobType: undefined });
  });

  it("accepts a blocked_external result when its blockerCode is declared for the Mission type", () => {
    const decision = decideReconciliation(
      {
        ...BASE_SNAPSHOT,
        execResult: { ok: true },
        resultReadCommandId: READ_COMMAND_ID,
        readResult: {
          ok: true,
          data: {
            content: JSON.stringify({
              status: "blocked_external",
              summary: "Instagram account unavailable",
              blockerCode: "account_unavailable",
              message: "Select the requested account on the execution device.",
            }),
          },
        },
      },
      { ...CTX, blockerCodes: ["account_unavailable"] },
    );

    expect(decision).toEqual({
      type: "markCompleted",
      result: {
        status: "blocked_external",
        summary: "Instagram account unavailable",
        blockerCode: "account_unavailable",
        message: "Select the requested account on the execution device.",
      },
    });
  });

  it("rejects a blocked_external result whose blockerCode is not declared for the Mission type", () => {
    const decision = decideReconciliation(
      {
        ...BASE_SNAPSHOT,
        execResult: { ok: true },
        resultReadCommandId: READ_COMMAND_ID,
        readResult: {
          ok: true,
          data: {
            content: JSON.stringify({
              status: "blocked_external",
              summary: "Instagram account unavailable",
              blockerCode: "unknown_blocker",
              message: "Select the requested account on the execution device.",
            }),
          },
        },
      },
      { ...CTX, blockerCodes: ["account_unavailable"] },
    );

    expect(decision).toMatchObject({ type: "markFailedRetryable", jobType: undefined });
    expect((decision as { error: string }).error).toContain('"unknown_blocker"');
  });

  it("rejects a blocked_external result when the Mission type declares no blockers", () => {
    const decision = decideReconciliation(
      {
        ...BASE_SNAPSHOT,
        execResult: { ok: true },
        resultReadCommandId: READ_COMMAND_ID,
        readResult: {
          ok: true,
          data: {
            content: JSON.stringify({
              status: "blocked_external",
              summary: "Unexpected blocker",
              blockerCode: "unexpected_blocker",
              message: "This Mission type has no declared human blocker.",
            }),
          },
        },
      },
      { ...CTX, blockerCodes: [] },
    );

    expect(decision).toMatchObject({ type: "markFailedRetryable", jobType: undefined });
  });
});
