import { z } from "zod";
import type { Doc, Id } from "./_generated/dataModel.js";
import type { RunResult } from "./run_result.js";

export const SOURCE_SCORING_JOB_TYPE = "source_scoring" as const;
export const MAX_SCORING_TRIES = 3;
export const SCORING_BATCH_LIMIT = 100;

export type ScoringBatch = {
  sourceIds: Id<"sources">[];
};

export type ScoringRuntime = {
  runNowRequestedAt?: number;
  runNowRestorePaused?: boolean;
  inFlightRunId?: Id<"runs">;
  inFlightBatch?: ScoringBatch;
  inFlightTries?: number;
  inFlightErrors?: string[];
};

const rubricScoreZ = z.union([
  z.literal(0),
  z.literal(0.25),
  z.literal(0.5),
  z.literal(0.75),
  z.literal(1),
]);

const scoreEntryZ = z.object({
  sourceId: z.string().min(1),
  productFit: rubricScoreZ,
  replicability: rubricScoreZ,
  creativeStrength: rubricScoreZ,
  creativeFamily: z.object({
    slug: z.string().trim().min(1),
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
  }).strict(),
}).strict();

export type SourceScore = z.infer<typeof scoreEntryZ> & { sourceId: Id<"sources"> };

export type ScoringValidation = {
  valid: SourceScore[];
  errors: string[];
};

function scoreEntrySummary(sourceId: string, detail: string): string {
  return `scores[${JSON.stringify(sourceId)}]: ${detail}`;
}

/**
 * Validate a batch result while retaining valid entries. A single malformed
 * Source must not discard scores that already satisfy the contract; invalid
 * entries are fed back to the next bounded attempt.
 */
export function validateScoringResult(
  result: RunResult,
  expectedSourceIds: readonly Id<"sources">[],
): ScoringValidation {
  if (result.status !== "success") {
    return { valid: [], errors: [`result status must be success, got ${result.status}`] };
  }

  const raw = result.additionalDetails && typeof result.additionalDetails === "object"
    ? (result.additionalDetails as Record<string, unknown>).scores
    : undefined;
  if (!Array.isArray(raw)) return { valid: [], errors: ["additionalDetails.scores must be an array"] };
  if (raw.length > SCORING_BATCH_LIMIT) {
    return { valid: [], errors: [`additionalDetails.scores must contain at most ${SCORING_BATCH_LIMIT} entries`] };
  }

  const expected = new Set(expectedSourceIds);
  const seen = new Set<string>();
  const valid: SourceScore[] = [];
  const errors: string[] = [];

  for (const [index, entry] of raw.entries()) {
    const sourceId = entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).sourceId === "string"
      ? (entry as Record<string, unknown>).sourceId as string
      : undefined;
    if (!sourceId) {
      errors.push(`scores[${index}].sourceId: required`);
      continue;
    }
    if (!expected.has(sourceId as Id<"sources">)) {
      errors.push(scoreEntrySummary(sourceId, "Source is not in the scoring batch"));
      continue;
    }
    if (seen.has(sourceId)) {
      errors.push(scoreEntrySummary(sourceId, "duplicate Source"));
      continue;
    }
    seen.add(sourceId);

    const parsed = scoreEntryZ.safeParse(entry);
    if (!parsed.success) {
      errors.push(scoreEntrySummary(sourceId, parsed.error.issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`).join(", ")));
      continue;
    }
    valid.push({ ...parsed.data, sourceId: sourceId as Id<"sources"> });
  }

  for (const sourceId of expectedSourceIds) {
    if (!seen.has(sourceId)) errors.push(scoreEntrySummary(sourceId, "missing result"));
  }

  return { valid, errors };
}

function sourceJson(source: Doc<"sources">): Record<string, unknown> {
  return {
    sourceId: source._id,
    type: source.sourceId,
    origin: source.origin,
    capturedAt: source.capturedAt,
    marketing: source.marketing,
    analysis: source.analysis,
  };
}

/** The single input file for one complete scoring pass. */
export function buildSourceScoringRunFile(args: {
  sources: Doc<"sources">[];
  feedback?: string[];
}): string {
  const lines = [
    "# Source scoring Job",
    "",
    "Score every Source in this batch. This is one Job Run, not a Mission: do not create files under missions/ and do not call any tool.",
    "",
    "Read the Source Agent scoring instructions at `jobs/source-scoring.md` before judging.",
    "",
    "## Sources",
    "",
    "```json",
    JSON.stringify(args.sources.map(sourceJson), null, 2),
    "```",
    "",
    "## Output",
    "",
    "Write the RunResult to the outputs file named in the command. Its `status` must be `success` and `additionalDetails.scores` must contain exactly one entry for every Source above:",
    "",
    '```json\n{ "status": "success", "summary": "Scored 2 Sources", "additionalDetails": { "scores": [ { "sourceId": "...", "productFit": 0.75, "replicability": 1, "creativeStrength": 0.5, "creativeFamily": { "slug": "mini_story", "name": "Mini Story", "description": "A short narrative format." } } ] } }\n```',
    "",
    "Use only rubric values 0, 0.25, 0.5, 0.75 or 1. Do not omit a Source. Do not return Partial or failed for an individual Source: valid entries are kept and invalid entries are retried with feedback.",
  ];
  if (args.feedback && args.feedback.length > 0) {
    lines.push("", "## Previous attempt feedback", "", ...args.feedback.map((error) => `- ${error}`), "", "Correct every listed entry and return the complete batch again.");
  }
  return `${lines.join("\n")}\n`;
}

export function scoringRuntime(job: Doc<"jobs">): ScoringRuntime {
  if (!job.runtime || typeof job.runtime !== "object" || Array.isArray(job.runtime)) return {};
  return job.runtime as ScoringRuntime;
}

export function isUnscored(source: Doc<"sources">): boolean {
  return source.status === "ready"
    && source.excluded !== true
    && source.scoring === undefined
    && Object.values(source.marketing).some((value) =>
      Array.isArray(value) ? value.length > 0 : typeof value === "string" && value.trim().length > 0,
    );
}
