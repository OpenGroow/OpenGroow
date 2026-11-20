import { describe, expect, it } from "vitest";
import { decideReconciliation, type ReconcileSnapshot } from "../mission_dispatcher/reconciliation.js";
import type { Id } from "../_generated/dataModel";

const MISSION_ID = "mission-plan" as Id<"missions">;
const RUN_ID = "run-plan" as Id<"runs">;
const CTX = {
  parent: { kind: "mission", missionId: MISSION_ID } as const,
  runId: RUN_ID,
  missionType: "plan",
  retryableFailureCount: 0,
  planReview: true,
};

const item = (n: number) => ({
  type: "create_article",
  payload: { topic: `topic ${n}` },
  reason: "Articles outperform the other formats",
  figures: [{ label: "Median views", value: 1200 }],
});

const resultFile = (result: Record<string, unknown>): ReconcileSnapshot => ({
  execResult: { ok: true },
  resultReadCommandId: "cmd" as Id<"commands">,
  readResult: { ok: true, data: { content: JSON.stringify(result) } },
  workspaceKey: "ws",
  timedOut: false,
  salvageTimedOut: false,
  finalReadCommandId: null,
  finalReadResult: null,
  maxMs: 60_000,
});

const plan = (items: unknown[]) => ({ status: "needs_human_review", summary: "Next week", reviewQuestions: [], plan: items });

describe("a Plan reported in the result file", () => {
  it("is carried by the completed result, up to five items", () => {
    const items = [1, 2, 3, 4, 5].map(item);
    expect(decideReconciliation(resultFile(plan(items)), CTX)).toMatchObject({
      type: "markCompleted",
      result: { status: "needs_human_review", plan: items },
    });
  });

  it("is refused above five items, with a clear reason the Agent can correct", () => {
    const decision = decideReconciliation(resultFile(plan([1, 2, 3, 4, 5, 6].map(item))), CTX);
    expect(decision).toMatchObject({ type: "markFailedRetryable", error: expect.stringMatching(/6 items: at most 5/) });
  });

  it("is refused when an item has no figures or no reason", () => {
    const noFigures = decideReconciliation(resultFile(plan([{ ...item(1), figures: [] }])), CTX);
    expect(noFigures).toMatchObject({ type: "markFailedRetryable", error: expect.stringMatching(/figures/) });
    const noReason = decideReconciliation(resultFile(plan([{ ...item(1), reason: undefined }])), CTX);
    expect(noReason).toMatchObject({ type: "markFailedRetryable", error: expect.stringMatching(/reason/) });
  });

  it("is required from a Mission type reviewed as a Plan", () => {
    const decision = decideReconciliation(
      resultFile({ status: "needs_human_review", summary: "Next week", reviewQuestions: [] }),
      CTX,
    );
    expect(decision).toMatchObject({ type: "markFailedRetryable", error: expect.stringMatching(/plan is required/) });
  });

  it("is not accepted from a Mission type that is not reviewed as a Plan", () => {
    const decision = decideReconciliation(resultFile(plan([item(1)])), { ...CTX, planReview: false });
    expect(decision).toMatchObject({ type: "markFailedRetryable", error: expect.stringMatching(/not reviewed as a Plan/) });
  });
});
