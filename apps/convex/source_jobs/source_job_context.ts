import type { SourceDeclaration } from "@opengroow/agent-templates";
import { buildSourceJsonSchema } from "../source_schema.js";
import { MAX_SOURCES_PER_RESULT } from "./limits.js";
import { formatSourceErrors, MAX_SOURCE_TRIES, type SourceError } from "./retry_feedback.js";

// Cap on the external job's output echoed into context.md: a runaway payload
// must not crowd out the schema and the instructions in the Agent's context.
const MAX_ENRICHMENT_OUTPUT_CHARS = 100_000;

/** What the enrichment a resumed execution follows ended with (issue #533). */
export type EnrichmentResumption = {
  sourceRef: string;
  sourceId: string;
  jobType?: string;
  /** The external job's output, when it completed. */
  output?: Record<string, unknown>;
  /** Why it did not complete; the Source is already `failed` or `unavailable`. */
  error?: string;
  sourceStatus?: string;
  /**
   * The Source as stored (without its `raw`), when it is still `processing`.
   * The enrichment output alone lacks required fields (`decision`, `capturedAt`,
   * `origin`): the agent completes this payload instead of rebuilding it.
   */
  stored?: { origin: string; capturedAt: number; marketing: unknown; analysis: unknown };
};

export type SourceJobContextInput = {
  declarations: SourceDeclaration[];
  /** Runs of the Agent's Missions completed after the cursor, up to the bound. */
  batchRunIds: string[];
  /**
   * Mission of each batch Run, when known. The agent has no shell to search
   * `missions/*` (its `exec` is restricted to a device CLI), so the report
   * path is given, not discovered.
   */
  batchRunMissionIds?: Record<string, string>;
  /** Sources flagged for retry, regardless of the cursor. */
  retrySources: { id: string; sourceId: string }[];
  cursorAt: number;
  boundAt: number;
  /** True for an execution resumed after an enrichment: its batch was already ingested. */
  resumed?: boolean;
  /** Errors of the previous try of this execution (#567): only the failed entries are expected back. */
  feedbackErrors?: SourceError[];
  /** What the enrichment this execution resumes from ended with. */
  enrichment?: EnrichmentResumption | null;
  /** Sources written and waiting for their enrichment to be handed off. */
  awaitingEnrichment?: { id: string; sourceId: string; origin: string }[];
};

function enrichmentSection(enrichment: EnrichmentResumption): string[] {
  const head = [
    "## Enrichment result",
    "",
    `Source \`${enrichment.sourceRef}\` (Source "${enrichment.sourceId}")${enrichment.jobType ? `, job "${enrichment.jobType}"` : ""}.`,
    "",
  ];
  if (enrichment.output === undefined) {
    return [
      ...head,
      `The enrichment did not complete: ${enrichment.error ?? "unknown error"}. OpenGroow already marked this Source ${enrichment.sourceStatus ?? "failed"}: there is nothing to write for it.`,
      "",
    ];
  }
  const json = JSON.stringify(enrichment.output, null, 2);
  const truncated = json.length > MAX_ENRICHMENT_OUTPUT_CHARS;
  return [
    ...head,
    `Complete this Source: put it again in the \`sources\` of your result file with the same payload shape and \`"id": "${enrichment.sourceRef}"\`, using the result below. The Source becomes \`ready\` when your result is accepted.`,
    "",
    ...(enrichment.stored
      ? [
          "The Source as currently stored (do not search for it anywhere: start from this payload, keep `origin`, `capturedAt` and `decision`, and fill the fields the enrichment result provides; omit `raw`):",
          "",
          "```json",
          JSON.stringify(
            { common: { origin: enrichment.stored.origin, capturedAt: enrichment.stored.capturedAt, marketing: enrichment.stored.marketing }, analysis: enrichment.stored.analysis },
            null,
            2,
          ),
          "```",
          "",
          "The enrichment result:",
          "",
        ]
      : []),
    "```json",
    truncated ? `${json.slice(0, MAX_ENRICHMENT_OUTPUT_CHARS)}\n... (truncated)` : json,
    "```",
    "",
  ];
}

/**
 * The single file a SourceJob execution reads (`jobs/<job>/run.md`). Pure. It
 * carries the merged schema (common layers + analysis) of every Source the
 * Agent declares, the batch — or, for an execution resumed after an
 * enrichment, the result to normalize — and the valid result shapes.
 */
export function buildSourceJobRunFile(input: SourceJobContextInput): string {
  const lines: string[] = [
    "# SourceJob run",
    "",
    "This session is a SourceJob, not a Mission: fetch, normalize and write the Sources below. Nothing here is reviewed by a human.",
    "",
  ];
  if (input.resumed) {
    lines.push(
      "This execution resumes the SourceJob after an enrichment. The batch was already ingested: do not write new Sources from Runs.",
      "",
    );
    if (input.enrichment) lines.push(...enrichmentSection(input.enrichment));
  } else {
    lines.push(
      `Batch window: Runs completed after ${new Date(input.cursorAt).toISOString()} and up to ${new Date(input.boundAt).toISOString()}.`,
      "",
      "## Runs to process",
      "",
      ...(input.batchRunIds.length > 0
        ? input.batchRunIds.map((id) => {
            const missionId = input.batchRunMissionIds?.[id];
            return missionId ? `- ${id} — report: missions/${missionId}/artifacts/${id}/report.json` : `- ${id}`;
          })
        : ["(none: no Mission Run completed in this window)"]),
      "",
      "## Sources to retry",
      "",
      ...(input.retrySources.length > 0
        ? input.retrySources.map((s) => `- ${s.id} (Source "${s.sourceId}")`)
        : ["(none)"]),
      "",
    );
  }
  if (input.feedbackErrors && input.feedbackErrors.length > 0) {
    lines.push(
      "## Errors of your previous attempt",
      "",
      `Your previous result was partly or wholly rejected. The entries not listed below were accepted and stored: do not resend them. Write only the failed entries, corrected, in \`sources\` (positions refer to your previous result file). You have ${MAX_SOURCE_TRIES} tries in all; after that the job fails.`,
      "",
      "```",
      formatSourceErrors(input.feedbackErrors),
      "```",
      "",
    );
  }
  lines.push(
    "## Sources awaiting enrichment",
    "",
    "Written and `processing`: each one still needs its external job handed off (see its instruction file). Hand off one per session.",
    "",
    ...(input.awaitingEnrichment && input.awaitingEnrichment.length > 0
      ? input.awaitingEnrichment.map((s) => `- ${s.id} (Source "${s.sourceId}") — origin: ${s.origin}`)
      : ["(none)"]),
    "",
    "## Declared Sources",
    "",
    "Each Source has its own instruction file; normalize every Source with the schema below and put it in the `sources` of your result file (see run.md). OpenGroow validates and stores them; you never call anything to write a Source.",
  );
  for (const declaration of input.declarations) {
    lines.push(
      "",
      `### "${declaration.type}" — ${declaration.label}`,
      "",
      `Instruction file: ${declaration.agentsMd}`,
      "",
      "```json",
      JSON.stringify(buildSourceJsonSchema(declaration), null, 2),
      "```",
    );
  }
  lines.push(
    "",
    "## Result",
    "",
    "Follow the instruction file of each declared Source.",
    "On completion, write the RunResult to the outputs file you were given: one JSON object with exactly the fields shown, nothing else (extra fields make the file invalid).",
    "",
    `- Everything went as expected (\`sources\` is empty when there was nothing to write; at most ${MAX_SOURCES_PER_RESULT} Sources per result, the rest is left to the next execution). Each entry of \`sources\` has exactly \`templateId\`, \`sourceId\`, \`common\`, \`analysis\` (and \`id\` only to complete a \`processing\` Source), as in the schemas above; owner, label, family, status and provenance are set by OpenGroow and rejected if you write them:`,
    '  `{ "status": "success", "summary": "<what you did>", "sources": [ { "templateId": "...", "sourceId": "...", "common": {}, "analysis": {} } ] }`',
    "- You could not do the work (a tool is unavailable):",
    '  `{ "status": "failed", "summary": "<what happened>", "error": { "code": "<short_code>", "message": "<why>" } }`',
    "",
    "- Handing a Source off to enrichment (one per session; all your Sources are stored, the enriched one stays `processing`). `job.sourcePosition` is the position in `sources` of the Source being enriched; for a Source already stored, write `job.sourceRef` (its id) instead, exactly one of the two:",
    '  `{ "status": "in_progress", "summary": "<what you did>", "sources": [ { "templateId": "...", "sourceId": "...", "common": {}, "analysis": {} } ], "job": { "mcpServer": "<server>", "jobId": "<id>", "jobType": "<tool>", "sourcePosition": 0 } }`',
    "",
    "No other `status` exists: `blocked` or `partial` are rejected. Report counts and blockers inside `summary`.",
    "",
  );
  return lines.join("\n") + "\n";
}
