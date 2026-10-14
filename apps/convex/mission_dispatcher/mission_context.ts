import { decideBoundedRetry, isRetryDecision } from "@opengroow/reliability";
import type { Id } from "../_generated/dataModel.js";
import { MAX_RETRYABLE_JOB_FAILURES } from "./external_job_polling.js";

export type MissionContextInput = {
  _id: Id<"missions">;
  templateId: string;
  type: string;
  payload: unknown;
  lastResult?: unknown;
  lastArtifact?: unknown;
  // Non-terminal value produced by an Intermediate External Job's completion
  // (ADR-026): `{ jobType, output }`. Replaced (never accumulated) on each
  // resumption — distinct from lastResult/lastArtifact, which are terminal.
  lastIntermediateResult?: unknown;
  // The most recent retryable External Job failure (`onFail: "resume_mission"`,
  // ADR-026 extension), e.g. the Letter service rejecting an over-length
  // title. Distinct from lastIntermediateResult: this is an error to fix,
  // not a non-terminal success value.
  lastRetryableFailure?: { jobType?: string; error: string; details?: unknown };
  // How many times this Mission has already been resumed after a retryable
  // External Job failure. Rendered alongside lastRetryableFailure as a
  // remaining-attempts count (out of MAX_RETRYABLE_JOB_FAILURES) — a "soft"
  // signal so the Agent knows how much budget is left, on top of the hard
  // cap Convex enforces regardless (decideExternalJobPoll). Neither alone is
  // sufficient: the hard cap protects the system from a looping Agent, the
  // soft signal helps a well-behaved Agent decide whether to keep trying or
  // give up early instead of blindly repeating the same mistake.
  retryableFailureCount?: number;
  brandCore?: BrandCoreContextInput | null;
};

export type RunContextInput = {
  _id: Id<"runs">;
  missionId: Id<"missions">;
  agentName: string;
  humanFeedback?: string;
};

export type MissionContextOutput = {
  contextMd: string;
  runMd: string;
};

export type BrandCoreContextInput = {
  audience?: string;
  tone?: string;
  offer?: string;
  positioning?: string;
  editorialRules?: string;
  constraints?: string;
  avoid?: string;
  notes?: string;
};

const BRAND_CORE_FIELDS: Array<{ key: keyof BrandCoreContextInput; label: string }> = [
  { key: "audience", label: "Audience" },
  { key: "tone", label: "Tone of Voice" },
  { key: "offer", label: "Offer" },
  { key: "positioning", label: "Positioning" },
  { key: "editorialRules", label: "Editorial Rules" },
  { key: "constraints", label: "Constraints" },
  { key: "avoid", label: "Things to Avoid" },
  { key: "notes", label: "Additional Notes" },
];

export function renderBrandCoreSection(brandCore: BrandCoreContextInput): string | null {
  const sections = BRAND_CORE_FIELDS.flatMap(({ key, label }) => {
    const value = brandCore[key]?.trim();
    return value ? [`## ${label}`, "", value, ""] : [];
  });

  if (sections.length === 0) {
    return null;
  }

  return [
    "# Brand Core",
    "",
    "Apply this brand guidance to everything you produce in this mission.",
    "",
    ...sections,
  ].join("\n");
}

export function buildMissionContext(
  mission: MissionContextInput,
  run: RunContextInput,
): MissionContextOutput {
  const payloadJson = JSON.stringify(mission.payload ?? {}, null, 2);
  const missionMdParts = [
    `# Mission ${mission._id}`,
    "",
    `- Template: \`${mission.templateId}\``,
    `- Type: \`${mission.type}\``,
    "",
    "## Payload",
    "",
    "```json",
    payloadJson,
    "```",
    "",
  ];
  if (mission.lastResult !== undefined) {
    missionMdParts.push(
      "## Last Result",
      "",
      "```json",
      JSON.stringify(mission.lastResult, null, 2),
      "```",
      "",
    );
  }
  const lastResultStatus =
    mission.lastResult != null &&
    typeof mission.lastResult === "object" &&
    "status" in (mission.lastResult as object)
      ? (mission.lastResult as { status: string }).status
      : undefined;
  if (lastResultStatus === "failed" && mission.lastArtifact != null) {
    missionMdParts.push(
      "## Last Artifact",
      "",
      "```json",
      JSON.stringify(mission.lastArtifact, null, 2),
      "```",
      "",
    );
  }
  if (mission.lastIntermediateResult !== undefined) {
    missionMdParts.push(
      "## Last Intermediate Result",
      "",
      "```json",
      JSON.stringify(mission.lastIntermediateResult, null, 2),
      "```",
      "",
    );
  }
  if (mission.lastRetryableFailure !== undefined) {
    const { jobType, error, details } = mission.lastRetryableFailure;
    const attemptsUsed = mission.retryableFailureCount ?? 1;
    // The remaining-attempts figure is the shared bounded-retry primitive's
    // (ADR-033) own reason to exist: it's what the External Job case surfaces
    // to the Agent here, computed from the same counter/bound shape
    // decideExternalJobPoll folds its retry decision through.
    const boundedRetryDecision = decideBoundedRetry(
      { attempts: attemptsUsed - 1 },
      { maxAttempts: MAX_RETRYABLE_JOB_FAILURES },
    );
    const attemptsRemaining = isRetryDecision(boundedRetryDecision)
      ? boundedRetryDecision.attemptsRemaining
      : 0;
    missionMdParts.push(
      "## Previous Attempt Failed",
      "",
      `Your last attempt failed${jobType ? ` (job: \`${jobType}\`)` : ""}: ${error}`,
      "",
      jobType
        ? "Fix the issue in your Manifest before retrying — do not repeat the same mistake."
        : "Fix the issue before retrying — write outputs.json that matches the required RunResult schema. Do not repeat the same mistake.",
      "",
      attemptsRemaining > 0
        ? `You have ${attemptsRemaining} attempt${attemptsRemaining === 1 ? "" : "s"} left after this one — if it fails again with the same kind of error, the Mission will end permanently.`
        : "This was your last attempt — if you cannot resolve the issue now, the Mission will end permanently.",
      "",
      ...(details !== undefined
        ? ["```json", JSON.stringify(details, null, 2), "```", ""]
        : []),
    );
  }
  const brandCoreMd = mission.brandCore ? renderBrandCoreSection(mission.brandCore) : null;
  const contextMd = brandCoreMd
    ? [brandCoreMd, missionMdParts.join("\n")].join("\n")
    : missionMdParts.join("\n");

  const contextPath = `missions/${mission._id}/context.md`;
  const outputsPath = `missions/${mission._id}/outputs/${run._id}.json`;
  const runMdParts = [
    `# Run ${run._id}`,
    "",
    `Read \`${contextPath}\` for the full mission specification.`,
    "",
    `On completion, write the RunResult JSON to \`${outputsPath}\`.`,
    "",
  ];
  if (run.humanFeedback) {
    runMdParts.push(
      "## Human Feedback",
      "",
      run.humanFeedback,
      "",
      "This is a revision run: a human reviewed your previous output and asked for changes. Do not resume or reuse a previous job, asset, or artifact id — apply this feedback and redo the affected work from the appropriate step.",
      "",
    );
  }
  const runMd = runMdParts.join("\n");

  return { contextMd, runMd };
}
