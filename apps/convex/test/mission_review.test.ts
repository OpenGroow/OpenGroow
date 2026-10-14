import { describe, expect, it } from "vitest";
import type { AgentManifest } from "@opengroow/agent-templates";
import {
  buildMissionReviewProjection,
  type MissionReviewSnapshot,
} from "../mission_review";

const manifest: AgentManifest = {
  id: "fixture",
  name: "Fixture",
  description: "Fixture manifest",
  category: "other",
  mcpServers: [{ name: "fixture-mcp", transport: "http", url: "https://fixture.invalid" }],
  requirements: [],
  missionTypes: [
    {
      type: "fixture_review",
      label: "Fixture review",
      payload: "{}",
      agentsMd: "fixture_review.md",
      review: {
        kind: "markdown",
        server: "fixture-mcp",
        path: "/review/{id}",
        actions: [
          {
            key: "publish",
            label: "Publish fixture",
            requiredStatus: "approved",
            inputs: [
              {
                key: "publishDate",
                label: "Publication date",
                type: "datetime-local",
                required: false,
              },
            ],
            transition: "done",
          },
          {
            key: "approve",
            label: "Validate fixture",
            requiredStatus: "to_validate",
            transition: "approved",
          },
          {
            key: "reject",
            label: "Reject fixture",
            requiredStatus: "to_validate",
            inputs: [
              { key: "feedback", label: "Feedback", type: "text", required: true },
            ],
            effect: { kind: "revision_run", feedbackKey: "feedback" },
            transition: "doing",
          },
        ],
      },
    },
  ],
};

function snapshot(overrides: Partial<MissionReviewSnapshot> = {}): MissionReviewSnapshot {
  return {
    status: "to_validate",
    missionType: "fixture_review",
    lastResult: {
      status: "needs_human_review",
      artifact: {
        kind: "markdown",
        external: { service: "fixture-mcp", id: "artifact-1" },
        metadata: { title: "Fixture", score: 1, featured: true },
      },
    },
    ...overrides,
  };
}

describe("buildMissionReviewProjection", () => {
  it("projects manifest labels, ordered actions, inputs, and eligibility", () => {
    const result = buildMissionReviewProjection(manifest, snapshot());

    expect(result.content).toEqual({
      kind: "markdown",
      source: "external",
      available: true,
    });
    expect(result.actions).toEqual([
      {
        key: "publish",
        label: "Publish fixture",
        requiredStatus: "approved",
        inputs: [
          {
            key: "publishDate",
            label: "Publication date",
            type: "datetime-local",
            required: false,
          },
        ],
        enabled: false,
        disabledReason: 'Requires mission status "approved"',
      },
      {
        key: "approve",
        label: "Validate fixture",
        requiredStatus: "to_validate",
        inputs: [],
        enabled: true,
      },
      {
        key: "reject",
        label: "Reject fixture",
        requiredStatus: "to_validate",
        inputs: [{ key: "feedback", label: "Feedback", type: "text", required: true }],
        enabled: true,
      },
    ]);
    expect(result.defaultActionKey).toBe("approve");
    expect(result.artifact).toEqual({
      available: true,
      kind: "markdown",
      externalId: "artifact-1",
      metadata: { title: "Fixture", score: 1, featured: true },
    });
    expect(JSON.stringify(result)).not.toContain("fixture-mcp");
    expect(JSON.stringify(result)).not.toContain("/review/");
  });

  it.each([
    ["metadata", "metadata"],
    ["image", "image"],
    ["video", "video"],
  ] as const)("keeps the declared %s content kind", (kind, expectedKind) => {
    const kindManifest = {
      ...manifest,
      missionTypes: manifest.missionTypes?.map((missionType) => ({
        ...missionType,
        review: { ...missionType.review!, kind },
      })),
    };

    expect(buildMissionReviewProjection(kindManifest, snapshot()).content?.kind).toBe(expectedKind);
  });

  it("describes workspace content without exposing a service URL", () => {
    const result = buildMissionReviewProjection(
      undefined,
      snapshot({
        missionType: "engage",
        lastResult: {
          status: "needs_human_review",
          artifact: {
            kind: "metadata",
            external: { service: "workspace", id: "reports/result.json" },
          },
        },
      }),
    );

    expect(result.content).toEqual({
      kind: "metadata",
      source: "workspace",
      available: true,
    });
    expect(result.actions).toEqual([]);
    expect(result.errors).toEqual(["Template not found"]);
  });

  it("reports a mission type without a review contract and its unavailable actions", () => {
    const result = buildMissionReviewProjection(
      manifest,
      snapshot({ missionType: "not_reviewable", status: "done" }),
    );

    expect(result.content).toBeNull();
    expect(result.actions).toEqual([]);
    expect(result.reviewable).toBe(false);
    expect(result.errors).toEqual(["Mission type does not declare a review contract"]);
  });

  it("keeps revision rejection available when a review artifact is missing", () => {
    const result = buildMissionReviewProjection(
      manifest,
      snapshot({ lastResult: undefined }),
    );

    expect(result.actions.find((action) => action.key === "approve")).toMatchObject({
      enabled: false,
      disabledReason: "No artifact available for this mission",
    });
    expect(result.actions.find((action) => action.key === "reject")).toMatchObject({
      enabled: true,
    });
  });
});
