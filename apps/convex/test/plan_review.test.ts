import { describe, expect, it } from "vitest";
import type { AgentManifest } from "@opengroow/agent-templates";
import { buildMissionReviewProjection } from "../mission_review";

const manifest: AgentManifest = {
  id: "strategy",
  name: "Strategy",
  description: "Plans the next Missions",
  category: "other",
  mcpServers: [],
  requirements: [],
  missionTypes: [
    {
      type: "plan",
      label: "Plan",
      payload: "{}",
      agentsMd: "plan.md",
      review: {
        kind: "plan",
        actions: [
          {
            key: "reject",
            label: "Reject",
            requiredStatus: "to_validate",
            inputs: [{ key: "feedback", label: "Feedback", type: "text", required: true }],
            effect: { kind: "revision_run", feedbackKey: "feedback" },
            transition: "doing",
          },
        ],
      },
    },
  ],
};

const items = [
  {
    type: "create_article",
    payload: { topic: "pricing" },
    reason: "Articles outperform the other formats",
    figures: [{ label: "Median views", value: 1200 }],
  },
];

const review = (status: string, lastResult?: unknown) =>
  buildMissionReviewProjection(manifest, { status, missionType: "plan", lastResult });

describe("the review of a Plan", () => {
  it("shows every item with its type, payload, reason and figures", () => {
    const projection = review("to_validate", { status: "needs_human_review", summary: "Next week", reviewQuestions: [], plan: items });
    expect(projection.plan).toEqual(items);
    expect(projection.reviewable).toBe(true);
    expect(projection.errors).toEqual([]);
  });

  it("needs no artifact and loads no content", () => {
    const projection = review("to_validate", { status: "needs_human_review", summary: "s", reviewQuestions: [], plan: items });
    expect(projection.content).toBeNull();
  });

  it("can be rejected with a feedback, which asks the Agent for a new Run of the same Mission", () => {
    const projection = review("to_validate", { status: "needs_human_review", summary: "s", reviewQuestions: [], plan: items });
    expect(projection.actions).toEqual([
      expect.objectContaining({ key: "reject", enabled: true, inputs: [expect.objectContaining({ key: "feedback", required: true })] }),
    ]);
    expect(projection.defaultActionKey).toBe("reject");
  });

  it("has nothing to show before the Agent has reported one", () => {
    const projection = review("doing");
    expect(projection.plan).toBeUndefined();
    expect(projection.reviewable).toBe(false);
  });
});
