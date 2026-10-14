import { describe, expect, it } from "vitest";
import { expandManifestSource } from "./expand-manifest-source.js";

const REVIEW = { kind: "video", server: "mcp", path: "/videos/{id}/final", actions: [{ key: "approve" }] };
const JOB = { server: "mcp", mcpTool: "get_run_status", onComplete: "terminal" };
const GENERATIVE = { toolName: "produce_video" };

function source(overrides: Record<string, unknown> = {}) {
  return {
    id: "demo",
    name: "Demo",
    missionContract: { review: REVIEW, externalJobs: { produce_video: JOB }, generativeMcpCall: GENERATIVE },
    missionTypes: [
      { type: "type_a", agentsMd: "a.md", label: "A", payload: "{}" },
      { type: "type_b", agentsMd: "b.md", label: "B", payload: "{}" },
    ],
    ...overrides,
  };
}

describe("expandManifestSource", () => {
  it("copies the shared contract into every Mission type", () => {
    const manifest = expandManifestSource(source());
    expect(manifest.missionTypes).toEqual([
      { type: "type_a", agentsMd: "a.md", label: "A", payload: "{}", review: REVIEW },
      { type: "type_b", agentsMd: "b.md", label: "B", payload: "{}", review: REVIEW },
    ]);
    expect(manifest.externalJobsByMissionType).toEqual({
      type_a: { produce_video: JOB },
      type_b: { produce_video: JOB },
    });
    expect(manifest.generativeMcpCall).toEqual({ type_a: GENERATIVE, type_b: GENERATIVE });
  });

  it("does not leak the source-only section into the manifest", () => {
    expect(expandManifestSource(source())).not.toHaveProperty("missionContract");
  });

  it("gives each Mission type its own copy, so editing one never changes another", () => {
    const manifest = expandManifestSource(source());
    expect(manifest.missionTypes![0].review).not.toBe(manifest.missionTypes![1].review);
    expect(manifest.externalJobsByMissionType!.type_a).not.toBe(manifest.externalJobsByMissionType!.type_b);

    // A shallow copy would still share the nested objects: mutate them in type_a only.
    const reviewA = manifest.missionTypes![0].review as { actions: Array<{ key: string }> };
    reviewA.actions[0].key = "mutated";
    const jobsA = manifest.externalJobsByMissionType!.type_a as { produce_video: { onComplete: string } };
    jobsA.produce_video.onComplete = "mutated";
    const generativeA = (manifest.generativeMcpCall as Record<string, { toolName: string }>).type_a;
    generativeA.toolName = "mutated";

    expect((manifest.missionTypes![1].review as { actions: Array<{ key: string }> }).actions[0].key).toBe("approve");
    expect(
      (manifest.externalJobsByMissionType!.type_b as { produce_video: { onComplete: string } }).produce_video.onComplete,
    ).toBe("terminal");
    expect((manifest.generativeMcpCall as Record<string, { toolName: string }>).type_b.toolName).toBe("produce_video");
    // ...and the shared constants the source was built from are untouched.
    expect(REVIEW.actions[0].key).toBe("approve");
    expect(JOB.onComplete).toBe("terminal");
  });

  it("generates the contract for a Mission type named after an Object.prototype member", () => {
    const manifest = expandManifestSource(
      source({
        missionTypes: [
          { type: "toString", agentsMd: "a.md", label: "A", payload: "{}" },
          { type: "constructor", agentsMd: "b.md", label: "B", payload: "{}" },
        ],
      }),
    );
    expect(Object.keys(manifest.generativeMcpCall as object)).toEqual(["toString", "constructor"]);
    expect(Object.keys(manifest.externalJobsByMissionType as object)).toEqual(["toString", "constructor"]);
  });

  it("keeps a review contract a Mission type declares itself", () => {
    const own = { kind: "markdown", server: "mcp", path: "/own", actions: [] };
    const manifest = expandManifestSource(
      source({
        missionTypes: [
          { type: "type_a", agentsMd: "a.md", label: "A", payload: "{}", review: own },
          { type: "type_b", agentsMd: "b.md", label: "B", payload: "{}" },
        ],
      }),
    );
    expect(manifest.missionTypes![0].review).toEqual(own);
    expect(manifest.missionTypes![1].review).toEqual(REVIEW);
  });

  it("returns a source with no shared contract unchanged", () => {
    const plain = {
      id: "demo",
      name: "Demo",
      missionTypes: [{ type: "type_a", agentsMd: "a.md", label: "A", payload: "{}" }],
    };
    expect(expandManifestSource(plain)).toEqual(plain);
  });
});
