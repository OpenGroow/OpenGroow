import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OPTIONAL_PUBLISHABLE_FIELDS, PUBLISHABLE_KINDS } from "@opengroow/agent-templates";
import { convexTest } from "convex-test";
import { internal } from "../_generated/api";
import schema from "../schema";
import { decideReconciliation, type ReconcileSnapshot } from "../mission_dispatcher/reconciliation.js";
import { type Publishable, publishableForPlatform, publishableJsonSchema, publishableSchema, renderPublishableSection } from "../publishable.js";
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
  publish: { kind: "video" | "image" | "carousel"; targets?: string[]; require?: readonly string[] } | undefined,
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

  it("accepts link, altText and tags where they apply and rejects them elsewhere", () => {
    const ok = (p: unknown, kind: "video" | "image" | "carousel") => decide(p, { kind, targets: ["x"] });
    expect(ok({ ...VIDEO, link: "https://e.com/x", tags: ["a", "b"] }, "video")).toMatchObject({ type: "markCompleted" });
    expect(ok({ ...IMAGE, link: "https://e.com/x", altText: "A cat" }, "image")).toMatchObject({ type: "markCompleted" });
    expect(ok({ ...CAROUSEL, altText: "A cat" }, "carousel")).toMatchObject({ type: "markCompleted" });
    expect(ok({ ...IMAGE, altText: "x".repeat(1001) }, "image")).toMatchObject({ type: "markFailedRetryable" });
    expect(ok({ ...IMAGE, link: "nope" }, "image")).toMatchObject({ type: "markFailedRetryable" });
    expect(ok({ ...VIDEO, altText: "x" }, "video")).toMatchObject({ type: "markFailedRetryable" });
  });

  it("enforces publish.require with a precise per-field error for the Agent", () => {
    const publish = { kind: "video", require: ["title", "coverUrl"] } as const;
    const decision = decide({ ...VIDEO, title: "T" }, publish);
    expect(decision).toMatchObject({ type: "markFailedRetryable" });
    const error = (decision as { error: string }).error;
    expect(error).toContain("artifact.publishable.coverUrl is required");
    expect(error).not.toContain("artifact.publishable.title");
    expect(decide({ ...VIDEO, title: "T", coverUrl: "https://cdn.example.com/c.png" }, publish)).toMatchObject({
      type: "markCompleted",
    });
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

  it("requires a Publishable from a needs_human_review result too: it reaches the review that publishes it", () => {
    const review = (artifact: Record<string, unknown>) =>
      decideReconciliation(
        {
          ...SNAPSHOT,
          readResult: {
            ok: true,
            data: { content: JSON.stringify({ status: "needs_human_review", summary: "s", reviewQuestions: [], artifact }) },
          },
        },
        { ...BASE_CTX, publish: { kind: "image", targets: ["instagram"] } },
      );
    const external = { service: "media", id: "42" };
    expect(review({ external })).toMatchObject({ type: "markFailedRetryable" });
    expect(review({ external, publishable: IMAGE })).toMatchObject({ type: "markCompleted" });
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

  it("lists the fields this Mission type requires in the Publishable section", () => {
    const md = renderPublishableSection("video", { require: ["title", "coverUrl"] });
    expect(md).toContain("`title`, `coverUrl`");
    expect(renderPublishableSection("video")).not.toContain("also required");
  });

  it("pins the manifest's optional fields to the zod schema", () => {
    for (const option of publishableSchema.options) {
      const optional = Object.entries(option.shape)
        .filter(([key, field]) => key !== "metadata" && key !== "imageUrl" && key !== "slideUrls" && (field as z.ZodType).safeParse(undefined).success)
        .map(([key]) => key);
      expect([...OPTIONAL_PUBLISHABLE_FIELDS[option.shape.kind.value]].sort()).toEqual(optional.sort());
    }
  });

  it("derives the JSON Schema given to Agents for one kind", () => {
    const schema = publishableJsonSchema("carousel") as {
      properties: Record<string, { const?: string }>;
      required: string[];
    };
    expect(schema.properties.kind.const).toBe("carousel");
    expect(schema.required).toEqual(expect.arrayContaining(["kind", "caption"]));
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(["slideUrls", "variants"]));
    expect(renderPublishableSection("carousel")).toContain("`slideUrls` or `variants`");
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

describe("Publishable variants (ADR-073)", () => {
  const A = "https://cdn.example.com/a.png";
  const B = "https://cdn.example.com/b.png";
  const carousel = {
    kind: "carousel",
    caption: "default",
    variants: {
      instagram: { slideUrls: [A], caption: "ig" },
      pinterest: { slideUrls: [B], title: "pin", caption: "pin text", link: "https://example.com/p" },
    },
  };

  it("accepts slideUrls or variants, never neither", () => {
    expect(publishableSchema.safeParse({ kind: "carousel", caption: "c", slideUrls: [A] }).success).toBe(true);
    expect(publishableSchema.safeParse(carousel).success).toBe(true);
    expect(publishableSchema.safeParse({ kind: "carousel", caption: "c" }).success).toBe(false);
    expect(publishableSchema.safeParse({ kind: "image", caption: "c", variants: {} }).success).toBe(false);
    expect(publishableSchema.safeParse({ kind: "image", caption: "c", variants: { tiktok: { imageUrl: A } } }).success).toBe(true);
  });

  it("picks the variant of the channel's service and overrides its text", () => {
    const result = publishableForPlatform(carousel, "pinterest");
    expect(result).toEqual({
      ok: true,
      publishable: { kind: "carousel", caption: "pin text", slideUrls: [B], title: "pin", link: "https://example.com/p" },
    });
  });

  it("falls back from a service to its family", () => {
    expect(publishableForPlatform(carousel, "instagram-standalone")).toMatchObject({ ok: true, publishable: { slideUrls: [A], caption: "ig" } });
  });

  it("refuses a channel the variants do not serve, naming the services it was made for", () => {
    expect(publishableForPlatform(carousel, "x")).toEqual({
      ok: false,
      error: "this carousel was made for instagram, pinterest only, it has no media for x",
    });
  });

  it("keeps the default media for a channel without a variant, and a Publishable without variants as is", () => {
    const withDefault = { kind: "carousel", caption: "c", slideUrls: [A], variants: { tiktok: { slideUrls: [B] } } };
    expect(publishableForPlatform(withDefault, "x")).toEqual({ ok: true, publishable: { kind: "carousel", caption: "c", slideUrls: [A] } });
    expect(publishableForPlatform({ kind: "video", videoUrl: A, caption: "c" }, undefined)).toEqual({
      ok: true,
      publishable: { kind: "video", videoUrl: A, caption: "c" },
    });
  });
});
