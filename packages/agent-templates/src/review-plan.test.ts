import { describe, it, expect } from "vitest";
import { validateManifest } from "./index.js";

const manifestWith = (review: unknown) => ({
  id: "strategy",
  name: "Strategy",
  description: "Plans the next Missions",
  category: "demo",
  mcpServers: [],
  missionTypes: [{ type: "plan", label: "Plan", payload: "{}", agentsMd: "plan.md", review }],
});

const REJECT = {
  key: "reject",
  label: "Reject",
  requiredStatus: "to_validate",
  inputs: [{ key: "feedback", label: "Feedback", type: "text", required: true }],
  effect: { kind: "revision_run", feedbackKey: "feedback" },
  transition: "doing",
};

describe("review kind plan", () => {
  it("is accepted without a server or a path", () => {
    expect(validateManifest(manifestWith({ kind: "plan", actions: [REJECT] })).ok).toBe(true);
  });

  it("refuses a plan review that points at content to load", () => {
    const result = validateManifest(manifestWith({ kind: "plan", server: "x", path: "/plan/{id}" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/plan/);
  });

  it("refuses a plan review in the workspace variant", () => {
    expect(validateManifest(manifestWith({ kind: "plan", service: "workspace" })).ok).toBe(false);
  });

  it("refuses a malformed action of a plan review", () => {
    expect(validateManifest(manifestWith({ kind: "plan", actions: [{ key: "reject" }] })).ok).toBe(false);
  });
});

const APPROVE = {
  key: "approve",
  label: "Approve",
  requiredStatus: "to_validate",
  inputs: [{ key: "items", label: "Items", type: "plan_selection", required: false }],
  effect: { kind: "approve_plan", selectionKey: "items" },
  transition: "done",
};

describe("approving a Plan", () => {
  const withApprove = (patch: Record<string, unknown>) => manifestWith({ kind: "plan", actions: [{ ...APPROVE, ...patch }] });

  it("accepts the selection input and the internal approve effect", () => {
    expect(validateManifest(withApprove({})).ok).toBe(true);
  });

  it("refuses an approve effect whose selectionKey names no plan_selection input", () => {
    expect(validateManifest(withApprove({ effect: { kind: "approve_plan", selectionKey: "other" } })).ok).toBe(false);
    expect(validateManifest(withApprove({ effect: { kind: "approve_plan" } })).ok).toBe(false);
    expect(
      validateManifest(withApprove({ inputs: [{ key: "items", label: "Items", type: "text", required: false }] })).ok,
    ).toBe(false);
  });

  it("refuses an approve effect on anything but the approve action or a done transition", () => {
    expect(validateManifest(withApprove({ key: "publish" })).ok).toBe(false);
    expect(validateManifest(withApprove({ transition: "approved" })).ok).toBe(false);
  });

  it("refuses an unknown key on the effect", () => {
    expect(validateManifest(withApprove({ effect: { kind: "approve_plan", selectionKey: "items", x: 1 } })).ok).toBe(false);
  });

  it("refuses a plan approval on a review that is not a Plan", () => {
    const review = { kind: "markdown", server: "x", path: "/a/{id}", actions: [APPROVE] };
    expect(validateManifest({ ...manifestWith(review), mcpServers: [{ name: "x", url: "https://example.com/mcp" }] }).ok).toBe(false);
  });

  it("refuses a required selection, since every item is selected by default", () => {
    expect(validateManifest(withApprove({ inputs: [{ ...APPROVE.inputs[0], required: true }] })).ok).toBe(false);
  });
});
