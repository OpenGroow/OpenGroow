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
