import { describe, expect, it } from "vitest";
import { decideReconciliation, type ReconcileSnapshot } from "../mission_dispatcher/reconciliation.js";
import type { Id } from "../_generated/dataModel";

// ADR-087: the reconciliation decision of a Standalone Run (a Recipe Generation) is a pure function.

const RUN_ID = "run-xyz" as Id<"runs">;
const READ_COMMAND_ID = "cmd-read" as Id<"commands">;
const CTX = { parent: { kind: "standalone", runId: RUN_ID } as const, runId: RUN_ID, missionType: "", retryableFailureCount: 0, recipeGeneration: true };

const BASE: ReconcileSnapshot = {
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
const fileWith = (content: string) =>
  ({ ...BASE, execResult: { ok: true }, resultReadCommandId: READ_COMMAND_ID, readResult: { ok: true, data: { content } } }) as ReconcileSnapshot;

describe("decideReconciliation of a Standalone Run", () => {
  it("reads the result under its own folder", () => {
    expect(decideReconciliation({ ...BASE, execResult: { ok: true } } as ReconcileSnapshot, CTX)).toEqual({
      type: "enqueueRead", role: "result", filePath: `standalone/${RUN_ID}/outputs/${RUN_ID}.json`,
    });
  });

  it("hands the parsed file over as is, whatever it holds, for Convex to validate", () => {
    const envelope = { kind: "no_opportunity", reason: "already_covered" };
    expect(decideReconciliation(fileWith(JSON.stringify(envelope)), CTX)).toEqual({ type: "persistRecipeProposal", envelope });
    expect(decideReconciliation(fileWith(JSON.stringify({ anything: 1 })), CTX)).toEqual({ type: "persistRecipeProposal", envelope: { anything: 1 } });
  });

  it("fails an unreadable file for a retry with feedback, never as a Mission resume", () => {
    expect(decideReconciliation(fileWith("not json"), CTX)).toMatchObject({ type: "markFailed", code: "file_invalid", retryWithFeedback: true });
  });

  it("fails a missing file and an exec failure like any other Run, without feedback", () => {
    const missing = { ...fileWith("{}"), readResult: { ok: false, error: "ENOENT" } } as ReconcileSnapshot;
    expect(decideReconciliation(missing, CTX)).toMatchObject({ type: "markFailed", code: "file_missing" });
    const execFailed = { ...BASE, execResult: { ok: false, errorCode: "runtime", error: "boom" } } as ReconcileSnapshot;
    expect(decideReconciliation(execFailed, CTX)).toMatchObject({ type: "markFailed", code: "runtime" });
  });

  it("times out like any other Run", () => {
    const stuck = { ...BASE, timedOut: true, salvageTimedOut: true, resultReadCommandId: READ_COMMAND_ID };
    expect(decideReconciliation(stuck, CTX)).toMatchObject({ type: "markFailed", code: "timeout" });
  });
});
