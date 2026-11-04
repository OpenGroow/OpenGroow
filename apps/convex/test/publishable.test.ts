import { describe, expect, it } from "vitest";
import { PUBLISHABLE_KINDS } from "@opengroow/agent-templates";
import { convexTest } from "convex-test";
import { internal } from "../_generated/api";
import schema from "../schema";
import { decideReconciliation, type ReconcileSnapshot } from "../mission_dispatcher/reconciliation.js";
import { type Publishable, publishableJsonSchema, publishableSchema, renderPublishableSection } from "../publishable.js";
import type { Id } from "../_generated/dataModel";

// Issue #16, ADR-069: the Publishable of an Artifact, validated against the
// kind the Mission type declares. Driven through the reconciliation seam: the
// decision is what the Agent (retry with feedback) and the Mission observe.

const MISSION_PARENT = { kind: "mission", missionId: "mission-abc" as Id<"missions"> } as const;
const RUN_ID = "run-xyz" as Id<"runs">;
const BASE_CTX = { parent: MISSION_PARENT, runId: RUN_ID, missionType: "make", retryableFailureCount: 0 };
const SNAPSHOT: ReconcileSnapshot = {
  execResult: { ok: true },
  resultReadCommandId: "cmd-read" as Id<"commands">,
  readResult: null,
  workspaceKey: "ws-1",
  timedOut: false,
  salvageTimedOut: false,
  finalReadCommandId: null,
  finalReadResult: null,
  maxMs: 60_000,
};

function decide(
  publishable: unknown,
  publish: { kind: "video" | "image" | "carousel"; targets: string[] } | undefined,
  extraArtifact: Record<string, unknown> = {},
) {
  const artifact = {
    external: { service: "media", id: "42" },
    ...(publishable === undefined ? {} : { publishable }),
    ...extraArtifact,
  };
  return decideReconciliation(
    {
      ...SNAPSHOT,
      readResult: { ok: true, data: { content: JSON.stringify({ status: "success", summary: "done", artifact }) } },
    },
    { ...BASE_CTX, ...(publish ? { publish } : {}) },
  );
}

const VIDEO: Publishable = { kind: "video", videoUrl: "https://cdn.example.com/v.mp4", caption: "Hello" };
const IMAGE: Publishable = { kind: "image", imageUrl: "https://cdn.example.com/i.png", caption: "Hello" };
const CAROUSEL: Publishable = {
  kind: "carousel",
  slideUrls: ["https://cdn.example.com/1.png", "https://cdn.example.com/2.png"],
  caption: "Hello",
};

describe("Publishable in the Artifact of a RunResult", () => {
  it.each([
    ["video", VIDEO],
    ["image", IMAGE],
    ["carousel", CAROUSEL],
  ] as const)("accepts a valid %s Publishable", (kind, publishable) => {
    const decision = decide(publishable, { kind, targets: ["instagram"] });
    expect(decision).toMatchObject({ type: "markCompleted" });
    expect((decision as { result: { artifact?: { publishable?: unknown } } }).result.artifact?.publishable).toEqual(
      publishable,
    );
  });

  it("accepts the optional fields and a free metadata", () => {
    const publishable = { ...VIDEO, coverUrl: "https://cdn.example.com/c.png", title: "T", metadata: { hashtags: ["a"] } };
    expect(decide(publishable, { kind: "video", targets: ["instagram"] })).toMatchObject({ type: "markCompleted" });
  });

  it("rejects an invalid Publishable with per-field errors for the Agent", () => {
    const decision = decide(
      { kind: "carousel", slideUrls: ["not a url"], caption: 3 },
      { kind: "carousel", targets: ["instagram"] },
    );
    expect(decision).toMatchObject({ type: "markFailedRetryable" });
    const error = (decision as { error: string }).error;
    expect(error).toContain("artifact.publishable.slideUrls.0");
    expect(error).toContain("artifact.publishable.caption");
  });

  it("names a missing field", () => {
    const decision = decide({ kind: "video", caption: "Hi" }, { kind: "video", targets: ["x"] });
    expect(decision).toMatchObject({ type: "markFailedRetryable" });
    expect((decision as { error: string }).error).toContain("artifact.publishable.videoUrl");
  });

  it("rejects a Publishable of another kind than the declared one", () => {
    const decision = decide(IMAGE, { kind: "video", targets: ["instagram"] });
    expect(decision).toMatchObject({ type: "markFailedRetryable" });
    const error = (decision as { error: string }).error;
    expect(error).toContain('"image"');
    expect(error).toContain('"video"');
  });

  it("requires a Publishable when the Mission type declares publish", () => {
    const decision = decide(undefined, { kind: "video", targets: ["instagram"] });
    expect(decision).toMatchObject({ type: "markFailedRetryable" });
    expect((decision as { error: string }).error).toContain("publishable");
  });

  it("ends the Run failed once the retry budget is exhausted", () => {
    const decision = decideReconciliation(
      {
        ...SNAPSHOT,
        readResult: {
          ok: true,
          data: {
            content: JSON.stringify({ status: "success", summary: "d", artifact: { external: { service: "m", id: "1" } } }),
          },
        },
      },
      { ...BASE_CTX, retryableFailureCount: 99, publish: { kind: "video", targets: ["x"] } },
    );
    expect(decision).toMatchObject({ type: "markFailed", code: "file_invalid" });
  });

  it("does not require anything from a Mission type without publish", () => {
    expect(decide(undefined, undefined)).toMatchObject({ type: "markCompleted" });
  });

  it("does not demand a Publishable from a failed Run", () => {
    const decision = decideReconciliation(
      {
        ...SNAPSHOT,
        readResult: {
          ok: true,
          data: { content: JSON.stringify({ status: "failed", summary: "x", error: { code: "c", message: "m" } }) },
        },
      },
      { ...BASE_CTX, publish: { kind: "video", targets: ["x"] } },
    );
    expect(decision).toMatchObject({ type: "markCompleted" });
  });
});

describe("Publishable schema definition", () => {
  it("covers exactly the closed kinds the manifest validator accepts", () => {
    const kinds = publishableSchema.options.map((option) => option.shape.kind.value);
    expect([...kinds].sort()).toEqual([...PUBLISHABLE_KINDS].sort());
  });

  it("tells the Agent in context.md what to return and not to publish", () => {
    const md = renderPublishableSection("image");
    expect(md).toContain("artifact.publishable");
    expect(md).toContain("imageUrl");
    expect(md).toContain("Do not call any publishing tool");
  });

  it("derives the JSON Schema given to Agents for one kind", () => {
    const schema = publishableJsonSchema("carousel") as {
      properties: Record<string, { const?: string }>;
      required: string[];
    };
    expect(schema.properties.kind.const).toBe("carousel");
    expect(schema.required).toEqual(expect.arrayContaining(["kind", "slideUrls", "caption"]));
  });
});

describe("Publishable stored with a completed Run", () => {
  const modules = {
    "../_generated/api.ts": () => import("../_generated/api.js"),
    "../missions.ts": () => import("../missions.js"),
    "../runs.ts": () => import("../runs.js"),
  };

  it.each([VIDEO, IMAGE, CAROUSEL])("keeps the Publishable (%#) on the Mission's lastArtifact", async (publishable) => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const { missionId, runId } = await t.run(async (ctx) => {
      const missionId = await ctx.db.insert("missions", {
        ownerId: "o", instanceId: "i", templateId: "tpl", type: "make", payload: {}, status: "doing",
        createdAt: now, updatedAt: now,
      });
      const runId = await ctx.db.insert("runs", {
        missionId, ownerId: "o", instanceId: "i", templateId: "tpl", agentName: "a",
        sessionKey: "s", status: "running", createdAt: now, updatedAt: now,
      });
      return { missionId, runId };
    });
    await t.mutation(internal.runs.markCompleted, {
      runId,
      result: {
        status: "success",
        summary: "done",
        artifact: { external: { service: "media", id: "42" }, publishable },
      },
    });
    const mission = await t.run((ctx) => ctx.db.get(missionId));
    expect(mission?.lastArtifact?.publishable).toEqual(publishable);
  });
});
