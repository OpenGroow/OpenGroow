import { describe, expect, it } from "vitest";
import {
  classifyRetryableFailure,
  decideExternalJobPoll,
  MAX_RETRYABLE_JOB_FAILURES,
} from "../mission_dispatcher/external_job_polling.js";
import { resolveExternalJobContract } from "@opengroow/agent-templates";
import { officialFixtureTemplate } from "./helpers/template_registry.helpers";
import type { ExternalJobPollingContract } from "@opengroow/agent-templates";

const seo = await officialFixtureTemplate("@opengroow/seo");

const CONTRACT: ExternalJobPollingContract = {
  server: "video-mcp",
  mcpTool: "get_run_status",
  statusField: "status",
  terminalStates: { completed: ["completed", "success"], failed: ["failed"] },
  resultStatus: "needs_human_review",
  artifactKind: "video",
  onComplete: "terminal",
};

const CTX = {
  serverName: "video-mcp",
  jobId: "render-1",
  summary: "Rendering…",
  reviewQuestions: ["Ready to publish?"],
  maxMs: 60_000,
  jobType: "produce_video",
};

describe("classifyRetryableFailure", () => {
  it("returns true for a 4xx embedded in the message", () => {
    expect(classifyRetryableFailure("Letter service failed: 400 Bad Request — title too long")).toBe(true);
    expect(classifyRetryableFailure("422 Unprocessable Entity")).toBe(true);
    expect(classifyRetryableFailure("HTTP 499")).toBe(true);
  });

  it("returns false for a 5xx embedded in the message (server error, not agent-fixable)", () => {
    expect(classifyRetryableFailure("Letter service failed: 500 Internal Server Error")).toBe(false);
    expect(classifyRetryableFailure("503 Service Unavailable")).toBe(false);
  });

  it("returns false when no HTTP status code is present", () => {
    expect(classifyRetryableFailure("render crashed unexpectedly")).toBe(false);
  });

  it("returns false when the message is undefined", () => {
    expect(classifyRetryableFailure(undefined)).toBe(false);
  });

  it("returns false for a 3-digit number outside the HTTP status ranges (e.g. a duration or id)", () => {
    expect(classifyRetryableFailure("timed out after 999 attempts")).toBe(false);
  });
});

describe("decideExternalJobPoll", () => {
  it("waits while the job is still running and the run hasn't timed out", () => {
    expect(decideExternalJobPoll({ status: "rendering" }, CONTRACT, CTX, false)).toEqual({ type: "wait" });
  });

  it("fails with timeout when still running and the run has timed out", () => {
    const decision = decideExternalJobPoll({ status: "rendering" }, CONTRACT, CTX, true);
    expect(decision).toEqual({ type: "markFailed", code: "timeout", message: "Run exceeded 60000 ms" });
  });

  it("fails with external_job_failed when status is a declared failed terminal state", () => {
    const decision = decideExternalJobPoll({ status: "failed", error: "render crashed" }, CONTRACT, CTX, false);
    expect(decision).toEqual({
      type: "markFailed",
      code: "external_job_failed",
      message: "render crashed",
    });
  });

  it("fails with external_job_poll_failed on an empty/malformed status", () => {
    const decision = decideExternalJobPoll({ status: "" }, CONTRACT, CTX, false);
    expect(decision).toMatchObject({ type: "markFailed", code: "external_job_poll_failed" });
  });

  it("completes with needs_human_review and artifact.external.id = jobId when no resultIdField is declared", () => {
    const decision = decideExternalJobPoll({ status: "completed" }, CONTRACT, CTX, false);
    expect(decision).toEqual({
      type: "markCompleted",
      result: {
        status: "needs_human_review",
        summary: CTX.summary,
        reviewQuestions: CTX.reviewQuestions,
        artifact: { kind: "video", external: { service: "video-mcp", id: "render-1" }, metadata: {} },
      },
    });
  });

  it("treats every status in terminalStates.completed as terminal (e.g. the live 'success' value)", () => {
    const decision = decideExternalJobPoll({ status: "success" }, CONTRACT, CTX, false);
    expect(decision.type).toBe("markCompleted");
  });

  it("uses output[resultIdField] as artifact.external.id when the contract declares one", () => {
    const contract: ExternalJobPollingContract = { ...CONTRACT, resultIdField: "articleId" };
    const decision = decideExternalJobPoll(
      { status: "completed", output: { articleId: "art-123" } },
      contract,
      CTX,
      false,
    );
    expect(decision).toMatchObject({
      type: "markCompleted",
      result: { artifact: { external: { id: "art-123" } } },
    });
  });

  it("fails when resultIdField is declared but missing from the completed job's output", () => {
    const contract: ExternalJobPollingContract = { ...CONTRACT, resultIdField: "articleId" };
    const decision = decideExternalJobPoll({ status: "completed", output: {} }, contract, CTX, false);
    expect(decision).toMatchObject({ type: "markFailed", code: "external_job_poll_failed" });
  });

  it("writes a 'success' RunResult (mission goes directly to done) when the contract declares resultStatus success", () => {
    const contract: ExternalJobPollingContract = { ...CONTRACT, resultStatus: "success" };
    const decision = decideExternalJobPoll({ status: "completed" }, contract, CTX, false);
    expect(decision).toMatchObject({ type: "markCompleted", result: { status: "success" } });
  });

  describe("onComplete: resume_mission (Intermediate External Job, ADR-026)", () => {
    const RESUME_CONTRACT: ExternalJobPollingContract = { ...CONTRACT, onComplete: "resume_mission" };

    it("returns markResumed (not markCompleted) when the job reaches a completed status", () => {
      const decision = decideExternalJobPoll(
        { status: "completed", output: { articlePlan: { steps: ["outline", "draft"] } } },
        RESUME_CONTRACT,
        CTX,
        false,
      );
      expect(decision).toEqual({
        type: "markResumed",
        intermediateResult: { articlePlan: { steps: ["outline", "draft"] } },
        jobType: CTX.jobType,
      });
    });

    it("forwards an empty object when the completed job carries no output", () => {
      const decision = decideExternalJobPoll({ status: "completed" }, RESUME_CONTRACT, CTX, false);
      expect(decision).toEqual({ type: "markResumed", intermediateResult: {}, jobType: CTX.jobType });
    });

    it("still fails (markFailed) when the job reaches a declared failed terminal state", () => {
      const decision = decideExternalJobPoll(
        { status: "failed", error: "blocked" },
        RESUME_CONTRACT,
        CTX,
        false,
      );
      expect(decision).toEqual({
        type: "markFailed",
        code: "external_job_failed",
        message: "blocked",
      });
    });

    it("still fails with timeout when still running and the run has timed out, unchanged from a terminal contract", () => {
      const decision = decideExternalJobPoll({ status: "rendering" }, RESUME_CONTRACT, CTX, true);
      expect(decision).toEqual({ type: "markFailed", code: "timeout", message: "Run exceeded 60000 ms" });
    });
  });

  describe("onFail: resume_mission (retryable External Job failure, ADR-026 extension)", () => {
    const RETRYABLE_CONTRACT: ExternalJobPollingContract = { ...CONTRACT, onFail: "resume_mission" };

    it("returns markFailedRetryable (not markFailed) on a 4xx declared failed status, under the retry cap", () => {
      const decision = decideExternalJobPoll(
        {
          status: "failed",
          error: "Letter service failed: 400 Bad Request — title too long",
          output: { failedStep: "generateLetter" },
        },
        RETRYABLE_CONTRACT,
        { ...CTX, retryableFailureCount: 0 },
        false,
      );
      expect(decision).toEqual({
        type: "markFailedRetryable",
        jobType: CTX.jobType,
        error: "Letter service failed: 400 Bad Request — title too long",
        details: { failedStep: "generateLetter" },
      });
    });

    it("defaults retryableFailureCount to 0 when the caller omits it", () => {
      const decision = decideExternalJobPoll(
        { status: "failed", error: "422 Unprocessable Entity" },
        RETRYABLE_CONTRACT,
        CTX,
        false,
      );
      expect(decision.type).toBe("markFailedRetryable");
    });

    it("falls back to a terminal markFailed once retryableFailureCount reaches MAX_RETRYABLE_JOB_FAILURES, even on a 4xx", () => {
      const decision = decideExternalJobPoll(
        { status: "failed", error: "400 Bad Request — still broken" },
        RETRYABLE_CONTRACT,
        { ...CTX, retryableFailureCount: MAX_RETRYABLE_JOB_FAILURES },
        false,
      );
      expect(decision).toEqual({
        type: "markFailed",
        code: "external_job_failed",
        message: "400 Bad Request — still broken",
      });
    });

    it("falls back to a terminal markFailed on a 5xx, even under the retry cap (server error, not agent-fixable)", () => {
      const decision = decideExternalJobPoll(
        { status: "failed", error: "Letter service failed: 500 Internal Server Error" },
        RETRYABLE_CONTRACT,
        { ...CTX, retryableFailureCount: 0 },
        false,
      );
      expect(decision).toEqual({
        type: "markFailed",
        code: "external_job_failed",
        message: "Letter service failed: 500 Internal Server Error",
      });
    });

    it("falls back to a terminal markFailed when no HTTP status can be found in the error text", () => {
      const decision = decideExternalJobPoll(
        { status: "failed", error: "render crashed unexpectedly" },
        RETRYABLE_CONTRACT,
        { ...CTX, retryableFailureCount: 0 },
        false,
      );
      expect(decision).toEqual({
        type: "markFailed",
        code: "external_job_failed",
        message: "render crashed unexpectedly",
      });
    });

    it("falls back to a terminal markFailed when the job carries no error message at all", () => {
      const decision = decideExternalJobPoll(
        { status: "failed" },
        RETRYABLE_CONTRACT,
        { ...CTX, retryableFailureCount: 0 },
        false,
      );
      expect(decision).toEqual({
        type: "markFailed",
        code: "external_job_failed",
        message: "External job status: failed",
      });
    });

    it("timeout still fails terminally, unaffected by onFail: resume_mission", () => {
      const decision = decideExternalJobPoll(
        { status: "rendering" },
        RETRYABLE_CONTRACT,
        { ...CTX, retryableFailureCount: 0 },
        true,
      );
      expect(decision).toEqual({ type: "markFailed", code: "timeout", message: "Run exceeded 60000 ms" });
    });
  });

  describe("legacy Runs with no mcpJob.jobType (pre-#243, see schema.ts)", () => {
    // `jobType` is forwarded from `run.mcpJob.jobType` for legacy Runs written
    // before #243 (a pre-existing awaiting_job Run may have none). Contract
    // resolution (`resolveExternalJobContract`) is keyed by mission type only,
    // never by jobType, so an undefined jobType can never fail to resolve a
    // contract — it only ever affects the label on a resumed Mission's
    // Intermediate Result. These tests pin that decideExternalJobPoll never
    // crashes on it, on both the terminal and resume_mission branches.
    const LEGACY_CTX = { ...CTX, jobType: undefined };

    it("still fails normally (unaffected by a missing jobType) on a declared failed terminal state", () => {
      const decision = decideExternalJobPoll(
        { status: "failed", error: "render crashed" },
        CONTRACT,
        LEGACY_CTX,
        false,
      );
      expect(decision).toEqual({
        type: "markFailed",
        code: "external_job_failed",
        message: "render crashed",
      });
    });

    it("forwards jobType: undefined (does not crash) on markResumed", () => {
      const resumeContract: ExternalJobPollingContract = { ...CONTRACT, onComplete: "resume_mission" };
      const decision = decideExternalJobPoll({ status: "completed", output: { a: 1 } }, resumeContract, LEGACY_CTX, false);
      expect(decision).toEqual({ type: "markResumed", intermediateResult: { a: 1 }, jobType: undefined });
    });
  });

  describe("seo template's plan_article contract (create_article, ADR-026 / #245)", () => {
    const contract = resolveExternalJobContract(seo.manifest, "create_article", "plan_article")!;
    const planCtx = {
      serverName: "article-mcp",
      jobId: "plan-run-1",
      summary: "Planification de l'article en cours — keyword: best practices",
      reviewQuestions: ["Le plan d'article est-il pertinent ?"],
      maxMs: 60_000,
      jobType: "plan_article",
    };

    it("declares onComplete: resume_mission with both completed and skipped as non-error outcomes", () => {
      expect(contract.server).toBe("article-mcp");
      expect(contract.mcpTool).toBe("get_plan_status");
      expect(contract.onComplete).toBe("resume_mission");
      expect(contract.terminalStates.completed).toEqual(["completed", "skipped"]);
      expect(contract.terminalStates.failed).toEqual(["failed"]);
    });

    it("a plan_article job reaching 'completed' resumes the Mission with the planned articlePlan as Intermediate Result", () => {
      const decision = decideExternalJobPoll(
        { status: "completed", output: { articlePlan: { angle: "beginner", outline: ["intro", "steps"] } } },
        contract,
        planCtx,
        false,
      );
      expect(decision).toEqual({
        type: "markResumed",
        intermediateResult: { articlePlan: { angle: "beginner", outline: ["intro", "steps"] } },
        jobType: "plan_article",
      });
    });

    it("a plan_article job reaching 'skipped' also resumes the Mission, carrying the blocked reason", () => {
      const decision = decideExternalJobPoll(
        { status: "skipped", output: { reason: "serp_unavailable" } },
        contract,
        planCtx,
        false,
      );
      expect(decision).toEqual({
        type: "markResumed",
        intermediateResult: { reason: "serp_unavailable" },
        jobType: "plan_article",
      });
    });

    it("a genuine 'failed' status still fails the Run instead of resuming the Mission", () => {
      const decision = decideExternalJobPoll(
        { status: "failed", error: "planner crashed" },
        contract,
        planCtx,
        false,
      );
      expect(decision).toEqual({
        type: "markFailed",
        code: "external_job_failed",
        message: "planner crashed",
      });
    });
  });
});
