import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import type { RunResult } from "../run_result.js";
import { validateSourceWrite } from "../source_schema.js";
import { resolveSource } from "../source_enrichment.js";
import { completeSource, insertSource } from "../sources.js";
import type { SourceJobOutcome } from "../source_jobs.js";

import { MAX_SOURCES_PER_RESULT } from "./limits.js";
import { acceptedKey, feedbackOf, formatSourceErrors, type SourceError } from "./retry_feedback.js";

/** The subset of a Run the ingestion reads: its provenance and its Template. */
type IngestingRun = Pick<Doc<"runs">, "_id" | "ownerId" | "instanceId" | "templateId" | "resumedFromRunId"> & { jobId?: Id<"jobs"> };

export type IngestionOutcome = {
  /** The complete list of what was wrong, with each entry's position and origin. */
  errors: SourceError[];
  /** Keys of the entries inserted (or completed) by this try, see `acceptedKey`. */
  accepted: string[];
  /** Sources beyond the cap, neither validated nor inserted. */
  surplus: number;
  /** Position in the result -> id of the Source this try inserted or completed there. */
  ids: Map<number, Id<"sources">>;
};

/**
 * Validates and writes the Sources of a SourceJob Run's result, internally (no
 * HTTP). Same guarantees as the signed write route (#529), which this path
 * replaces for SourceJob executions: the Source id is declared by the Run's own
 * Template; label and family come from the declaration; status is `processing`
 * when an enrichment is declared, else `ready`; owner, instance and provenance
 * come from the Run, never from the entry (unknown keys are rejected by the
 * validation). Valid entries are kept when others are invalid.
 */
export async function ingestSources(
  ctx: MutationCtx,
  run: IngestingRun,
  sources: unknown[],
  alreadyAccepted: ReadonlySet<string> = new Set(),
): Promise<IngestionOutcome> {
  const errors: SourceError[] = [];
  const accepted: string[] = [];
  const ids = new Map<number, Id<"sources">>();
  const taken = sources.slice(0, MAX_SOURCES_PER_RESULT);

  for (const [index, entry] of taken.entries()) {
    const rawOrigin = (entry as { common?: { origin?: unknown } } | null)?.common?.origin;
    const origin = typeof rawOrigin === "string" ? rawOrigin : undefined;
    const fail = (messages: string[]) =>
      errors.push({ position: index, ...(origin ? { origin } : {}), messages });

    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      fail(["must be an object"]);
      continue;
    }
    const { templateId, sourceId } = entry as Record<string, unknown>;
    if (templateId !== run.templateId) {
      fail([`templateId: must be "${run.templateId}", the Template of this Agent`]);
      continue;
    }
    const resolved = typeof sourceId === "string" ? await resolveSource(ctx, run.instanceId, run.templateId, sourceId) : null;
    if (typeof sourceId !== "string" || !resolved) {
      fail([`sourceId: Template "${run.templateId}" does not declare Source "${String(sourceId)}"`]);
      continue;
    }

    const validation = validateSourceWrite(resolved.declaration, entry);
    if (!validation.ok) {
      fail(validation.errors);
      continue;
    }
    const { id, common, analysis } = validation.value;
    const key = acceptedKey({ ...(id !== undefined ? { id } : {}), sourceId, origin: common.origin });
    // An entry an earlier try of this execution chain already stored, resent.
    if (alreadyAccepted.has(key)) continue;

    if (id !== undefined) {
      // Enrichment phase (#533): complete the `processing` Source instead of appending.
      const completed = await completeSource(ctx, {
        id,
        instanceId: run.instanceId,
        templateId: run.templateId,
        sourceId,
        origin: common.origin,
        capturedAt: common.capturedAt,
        marketing: common.marketing,
        raw: common.raw,
        analysis,
      });
      if (completed.ok) {
        accepted.push(key);
        ids.set(index, completed.id);
      } else fail([completed.error]);
      continue;
    }

    const insertedId = await insertSource(ctx, {
      runId: run._id,
      ...(run.jobId ? { sourceJobId: run.jobId } : {}),
      instanceId: run.instanceId,
      ownerId: run.ownerId,
      templateId: run.templateId,
      sourceId,
      label: resolved.declaration.label,
      family: resolved.declaration.family,
      status: resolved.hasEnrichment ? "processing" : "ready",
      origin: common.origin,
      capturedAt: common.capturedAt,
      marketing: common.marketing,
      raw: common.raw,
      analysis,
    });
    accepted.push(key);
    ids.set(index, insertedId);
  }

  return { errors, accepted, surplus: Math.max(0, sources.length - taken.length), ids };
}

/** What the try this execution follows in its chain handed over (accepted entries, surplus), if any. */
async function previousFeedback(ctx: MutationCtx, run: IngestingRun) {
  return run.resumedFromRunId ? feedbackOf((await ctx.db.get(run.resumedFromRunId))?.intermediateResult) : undefined;
}

/** An invalid result: it is stored as failed with every error, and fed back to the Agent while tries remain. */
function rejectSources(
  summary: string,
  { errors, accepted, surplus }: Pick<IngestionOutcome, "errors" | "accepted" | "surplus">,
): { result: RunResult; outcome: SourceJobOutcome } {
  const message = `Invalid Sources in the result file:\n${formatSourceErrors(errors)}`;
  return {
    result: { status: "failed", summary, error: { code: "invalid_sources", message } },
    outcome: { ok: false, error: message, feedback: { errors, accepted, surplus: surplus > 0 } },
  };
}

/**
 * What a terminal SourceJob execution stores and reports (#564): its Sources are
 * ingested, and the Run's stored `result` plus the job's outcome follow.
 *
 * - invalid entries turn the success into a `failed` result carrying every
 *   error; the outcome carries them as feedback so the job resumes the Agent
 *   with them (bounded, #567) while the valid entries stay inserted;
 * - Sources over the cap keep the cursor, leaving the surplus to the next
 *   execution;
 * - a non-`success` result never ingests anything.
 */
export async function ingestAndDecideOutcome(
  ctx: MutationCtx,
  run: IngestingRun,
  result: RunResult,
  sources: unknown[] | undefined,
): Promise<{ result: RunResult; outcome: SourceJobOutcome }> {
  if (result.status !== "success") {
    return {
      result,
      outcome: {
        ok: false,
        error:
          result.status === "failed"
            ? `The Agent reported a failure: ${result.summary} (${result.error.code}: ${result.error.message})`
            : `RunResult ${result.status}: ${result.summary}`,
      },
    };
  }
  if (sources === undefined) return { result, outcome: { ok: true } };

  const previous = await previousFeedback(ctx, run);
  const { errors, accepted, surplus } = await ingestSources(ctx, run, sources, new Set(previous?.accepted));
  if (errors.length > 0) return rejectSources(result.summary, { errors, accepted, surplus });
  return { result, outcome: { ok: true, keepCursor: surplus > 0 || previous?.surplus === true } };
}

/**
 * An enrichment handoff (#568): the Sources of the result are ingested, and the
 * external job's `sourcePosition` is resolved to the id of the Source inserted
 * there (a `sourceRef` is already an id). On success, `sourceRef` is what the
 * polling engine links the job to, and `accepted`/`surplus` are what the
 * execution chain must remember. Otherwise the result is rejected like any
 * invalid one, the valid Sources being kept.
 */
export async function ingestHandoff(
  ctx: MutationCtx,
  run: IngestingRun,
  summary: string,
  sources: unknown[],
  job: { sourcePosition?: number; sourceRef?: string },
): Promise<
  | { ok: true; sourceRef: string | undefined; accepted: string[]; surplus: boolean }
  | { ok: false; result: RunResult; outcome: SourceJobOutcome }
> {
  const previous = await previousFeedback(ctx, run);
  const ingestion = await ingestSources(ctx, run, sources, new Set(previous?.accepted));
  const { errors, ids } = ingestion;

  let sourceRef = job.sourceRef;
  const position = job.sourcePosition;
  if (position !== undefined) {
    const linked = ids.get(position);
    if (linked) sourceRef = linked;
    else if (position >= sources.length) {
      errors.push({
        messages: [`job.sourcePosition: no Source at position ${position} (the result has ${sources.length} Sources, positions start at 0)`],
      });
    } else if (position >= MAX_SOURCES_PER_RESULT) {
      errors.push({
        messages: [`job.sourcePosition: position ${position} is over the ${MAX_SOURCES_PER_RESULT} Sources a result may carry`],
      });
    } else if (!errors.some((e) => e.position === position)) {
      errors.push({
        position,
        messages: [
          'job.sourcePosition: this Source was already stored by a previous try; hand it off with its id in job.sourceRef (see "Sources awaiting enrichment")',
        ],
      });
    }
  }
  if (errors.length > 0) return { ok: false, ...rejectSources(summary, ingestion) };
  return {
    ok: true,
    sourceRef,
    accepted: ingestion.accepted,
    surplus: ingestion.surplus > 0 || previous?.surplus === true,
  };
}
