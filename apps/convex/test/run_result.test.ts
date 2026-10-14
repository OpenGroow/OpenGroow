import { describe, expect, it } from "vitest";
import {
  formatMissingOutputMessage,
  formatRunResultIssues,
  runResultSchema,
  type RunResult,
} from "../run_result";

const successFixture: RunResult = {
  status: "success",
  summary: "Wrote draft article",
};

// Post-migration shape: identity in external.id, metadata is display-only (ADR-020 / #146).
const successWithArtifact = {
  status: "success" as const,
  summary: "Wrote draft article",
  artifact: {
    kind: "markdown" as const,
    external: { service: "article-mcp", id: "art-success-1" },
    metadata: { wordCount: 800, ready: true, slug: "abc" },
  },
};

const reviewFixture: RunResult = {
  status: "needs_human_review",
  summary: "Need a target audience",
  reviewQuestions: ["Who is the target reader?"],
};

// partialArtifact uses the generic shape (post-migration).
const reviewWithPartial = {
  status: "needs_human_review" as const,
  summary: "Need clarification",
  reviewQuestions: ["Q1", "Q2"],
  partialArtifact: {
    kind: "markdown" as const,
    external: { service: "article-mcp", id: "art-partial-1" },
    metadata: { wip: true },
  },
};

// Post-migration SEO review result — identity in external.id, keyword in metadata.
const seoReviewResult = {
  status: "needs_human_review" as const,
  summary: "Article generated — awaiting human review before publication.",
  reviewQuestions: ["Is the article ready to publish?"],
  artifact: {
    kind: "markdown" as const,
    external: { service: "article-mcp", id: "article-123" },
    metadata: {
      keyword: "octopus farming",
    },
  },
};

const failedFixture: RunResult = {
  status: "failed",
  summary: "Could not fetch SERP",
  error: { code: "serp_unreachable", message: "HTTP 503 from provider" },
};

// A Template-declared human-action blocker — a normal, terminal, non-error
// result (issue #323).
const blockedExternalFixture: RunResult = {
  status: "blocked_external",
  summary: "Waiting on the keyword batch to be validated on article-mcp's dashboard",
  blockerCode: "keyword_batch_pending",
  message: "Your first keyword batch needs human review before OpenGroow can proceed.",
  resolution: { kind: "link", url: "https://article-mcp.example.com/projects/abc/keywords/review" },
};

// The agent dispatches a long-running MCP job, then hands OpenGroow a pointer to
// it and exits, instead of polling the job to completion itself (issue #138).
const inProgressFixture = {
  status: "in_progress" as const,
  summary: "Video production started; awaiting render.",
  reviewQuestions: ["Is the video ready to publish?"],
  job: { mcpServer: "video-mcp", jobId: "render-abc-123", jobType: "produce_video" },
};

describe("runResultSchema", () => {
  describe("accepts each branch", () => {
    it("accepts a minimal success", () => {
      expect(runResultSchema.parse(successFixture)).toEqual(successFixture);
    });

    it("accepts success with artifact and flat metadata", () => {
      expect(runResultSchema.parse(successWithArtifact)).toEqual(successWithArtifact);
    });

    it("accepts success with additionalDetails", () => {
      const result = {
        ...successFixture,
        additionalDetails: {
          postsProcessed: 3,
          reportPath: "missions/mission-1/artifacts/run-1/report.json",
        },
      };
      expect(runResultSchema.parse(result)).toEqual(result);
    });

    it("accepts needs_human_review", () => {
      expect(runResultSchema.parse(reviewFixture)).toEqual(reviewFixture);
    });

    it("accepts needs_human_review with partialArtifact", () => {
      expect(runResultSchema.parse(reviewWithPartial)).toEqual(reviewWithPartial);
    });

    it("accepts needs_human_review with artifact in generic shape (external.id + metadata)", () => {
      expect(runResultSchema.parse(seoReviewResult)).toEqual(seoReviewResult);
    });

    it("accepts failed with error code+message", () => {
      expect(runResultSchema.parse(failedFixture)).toEqual(failedFixture);
    });

    it("accepts in_progress carrying an MCP job pointer", () => {
      expect(runResultSchema.parse(inProgressFixture)).toEqual(inProgressFixture);
    });

    it("accepts an in_progress job pointer naming the Source it enriches (SourceJob, #533)", () => {
      const withSource = { ...inProgressFixture, job: { ...inProgressFixture.job, sourceRef: "abc123" } };
      expect(runResultSchema.parse(withSource)).toEqual(withSource);
    });

    it("accepts blocked_external with a blocker code and resolution", () => {
      expect(runResultSchema.parse(blockedExternalFixture)).toEqual(blockedExternalFixture);
    });
  });

  describe("rejects malformed inputs", () => {
    it("rejects extra top-level field (strict)", () => {
      expect(() =>
        runResultSchema.parse({ ...successFixture, extra: "nope" }),
      ).toThrow();
    });

    it("strips unknown fields inside artifact (tolerant for agent transition)", () => {
      const result = runResultSchema.parse({
        ...successFixture,
        artifact: {
          kind: "markdown",
          external: { service: "article-mcp", id: "art-strip-test" },
          metadata: { ok: true },
          files: [{ path: "p", title: "t", contentType: "c" }],
        },
      });
      const artifact = (result as { artifact?: Record<string, unknown> }).artifact;
      expect(artifact).not.toHaveProperty("files");
      expect(artifact?.metadata).toEqual({ ok: true });
    });

    it("rejects artifact with only metadata and no external.id (legacy shape rejected)", () => {
      expect(() =>
        runResultSchema.parse({
          ...successFixture,
          artifact: { metadata: { articleId: "art-123" } },
        }),
      ).toThrow();
    });

    it("rejects artifact with empty external.id", () => {
      expect(() =>
        runResultSchema.parse({
          ...successFixture,
          artifact: { kind: "markdown", external: { service: "article-mcp", id: "" } },
        }),
      ).toThrow();
    });

    it("rejects missing summary on success", () => {
      expect(() => runResultSchema.parse({ status: "success" })).toThrow();
    });

    it("rejects missing reviewQuestions on needs_human_review", () => {
      expect(() =>
        runResultSchema.parse({ status: "needs_human_review", summary: "x" }),
      ).toThrow();
    });

    it("rejects missing error on failed", () => {
      expect(() => runResultSchema.parse({ status: "failed", summary: "x" })).toThrow();
    });

    it("rejects wrong type for summary", () => {
      expect(() =>
        runResultSchema.parse({ status: "success", summary: 42 }),
      ).toThrow();
    });

    it("rejects nested object inside metadata (flat only)", () => {
      expect(() =>
        runResultSchema.parse({
          status: "success",
          summary: "x",
          artifact: {
            kind: "markdown",
            external: { service: "article-mcp", id: "art-nested-test" },
            metadata: { nested: { a: 1 } },
          },
        }),
      ).toThrow();
    });

    it("rejects in_progress missing the job pointer", () => {
      expect(() =>
        runResultSchema.parse({
          status: "in_progress",
          summary: "started",
          reviewQuestions: ["q"],
        }),
      ).toThrow();
    });

    it("rejects in_progress whose job is missing jobId", () => {
      expect(() =>
        runResultSchema.parse({
          status: "in_progress",
          summary: "started",
          reviewQuestions: ["q"],
          job: { mcpServer: "video-mcp" },
        }),
      ).toThrow();
    });

    it("rejects blocked_external missing blockerCode", () => {
      expect(() =>
        runResultSchema.parse({
          status: "blocked_external",
          summary: "x",
          message: "Needs review",
          resolution: { kind: "link", url: "https://example.com" },
        }),
      ).toThrow();
    });

    it("rejects blocked_external missing message", () => {
      expect(() =>
        runResultSchema.parse({
          status: "blocked_external",
          summary: "x",
          blockerCode: "keyword_batch_pending",
        }),
      ).toThrow();
    });

    it("rejects blocked_external with extra unknown field (strict)", () => {
      expect(() =>
        runResultSchema.parse({
          ...blockedExternalFixture,
          extra: "nope",
        }),
      ).toThrow();
    });

    it("rejects unknown discriminator status", () => {
      expect(() =>
        runResultSchema.parse({ status: "weird", summary: "x" }),
      ).toThrow();
    });

    it("rejects empty error.code as missing? actually code is required string", () => {
      expect(() =>
        runResultSchema.parse({
          status: "failed",
          summary: "x",
          error: { message: "no code" },
        }),
      ).toThrow();
    });
  });
});

describe("formatRunResultIssues", () => {
  const parseError = (input: unknown) => {
    const result = runResultSchema.safeParse(input);
    if (result.success) throw new Error("expected parse to fail");
    return result.error;
  };

  it("never emits the raw Zod JSON dump", () => {
    const message = formatRunResultIssues(parseError({ status: "success" }));
    expect(message).not.toContain('"code"');
    expect(message).not.toContain("invalid_type");
    expect(message).not.toMatch(/^\s*\[/);
  });

  it("lists a single missing field readably", () => {
    const message = formatRunResultIssues(parseError({ status: "success" }));
    expect(message).toBe(
      "Output file doesn't match the expected format: missing summary",
    );
  });

  it("formats the real failed-pipeline payload into missing + unexpected", () => {
    // The shape an out-of-sync pipeline actually wrote (from the bug report):
    // failed status, but missing summary + error.code, and several stray keys.
    const message = formatRunResultIssues(
      parseError({
        status: "failed",
        error: { category: "x", details: "y" },
        runId: "r",
        projectId: "p",
        manifest: {},
        completedAt: 1,
      }),
    );
    expect(message).toContain("missing summary, error.code");
    expect(message).toContain(
      "unexpected error.category, error.details, runId, projectId, manifest, completedAt",
    );
    expect(message).not.toContain("invalid_type");
  });

  it("echoes the actual status the agent wrote on an invalid discriminator", () => {
    const input = { status: "completed", summary: "done" };
    const message = formatRunResultIssues(parseError(input), input);
    expect(message).toContain('status is "completed"');
    expect(message).toContain("in_progress");
    expect(message).not.toContain("Invalid discriminator value");
  });

  it("describes a type mismatch with expected vs received", () => {
    const message = formatRunResultIssues(
      parseError({ status: "success", summary: 42 }),
    );
    expect(message).toContain("summary should be string (got number)");
  });
});

describe("formatMissingOutputMessage", () => {
  const outputsPath = "missions/m1/outputs/r1.json";

  it("explains an absent file without leaking the raw ENOENT/container path", () => {
    const message = formatMissingOutputMessage(
      outputsPath,
      "ENOENT: no such file or directory, lstat '/home/node/.openclaw/workspace-abc/missions/m1/outputs'",
    );
    expect(message).toContain("finished without writing its result file");
    expect(message).toContain(`\`${outputsPath}\``);
    expect(message).not.toContain("ENOENT");
    expect(message).not.toContain("/home/node/");
  });

  it("treats a missing raw error (no content) as an absent file", () => {
    const message = formatMissingOutputMessage(outputsPath);
    expect(message).toContain("finished without writing its result file");
    expect(message).toContain(`\`${outputsPath}\``);
  });

  it("keeps the gist of a non-ENOENT read failure but strips absolute paths", () => {
    const message = formatMissingOutputMessage(
      outputsPath,
      "ECONNREFUSED reading '/home/node/.openclaw/workspace-abc/missions/m1/outputs/r1.json'",
    );
    expect(message).toContain("Could not read the agent's result file");
    expect(message).toContain("ECONNREFUSED");
    expect(message).not.toContain("/home/node/");
    expect(message).toContain(`\`${outputsPath}\``);
  });
});
