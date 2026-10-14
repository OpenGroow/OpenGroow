import { describe, expect, it } from "vitest";
import type { AgentManifest } from "@convex/template_manifest_contract";
import { hasEditableRequirements } from "../src/utils/agent-requirements";

const requirements = [{ key: "apiKey", label: "API key", type: "secret", required: true }];

function manifest(overrides: Record<string, unknown>) {
  return { id: "demo", name: "Demo", requirements, ...overrides } as unknown as AgentManifest;
}

describe("hasEditableRequirements", () => {
  it("is false when the Template cannot be reconfigured, even with editable fields", () => {
    expect(hasEditableRequirements(manifest({}))).toBe(false);
  });

  it("is true for a config-only reconfigurable Template with an editable field", () => {
    expect(hasEditableRequirements(manifest({ reconfigurable: true }))).toBe(true);
  });

  it("is true for a Template declaring a reconfiguration effect", () => {
    expect(hasEditableRequirements(manifest({ reconfiguration: { kind: "http" } }))).toBe(true);
  });

  it("is false when every field is immutable", () => {
    const immutable = [{ ...requirements[0], immutable: true }];
    expect(hasEditableRequirements(manifest({ reconfigurable: true, requirements: immutable }))).toBe(false);
  });
});
