import type { ActionCtx } from "../_generated/server.js";
import { internal } from "../_generated/api.js";
import {
  fetchExternalJobStatusFromEndpoint,
  loadProjectAgentApiKey,
  TransientExternalJobPollError,
  type AwaitingJobRun,
  type ExternalJobPollResult,
} from "../mission_dispatcher/external_job_poll_node.js";
import { decideSourceEnrichmentPoll } from "../mission_dispatcher/external_job_polling.js";
import { declaredEnrichment } from "../source_enrichment.js";
import { resolveTemplateMcpEndpoint } from "../mcp_endpoint.js";
import { getTemplateRegistry } from "../template_registry.js";
import { errorMessage } from "../mission_dispatcher/error_message.js";

type EnrichmentOutcome =
  | { kind: "completed"; output: Record<string, unknown> }
  | { kind: "failed"; sourceStatus: "failed" | "unavailable"; message: string };

/**
 * Poll the external job a SourceJob execution handed off for a Source (issue
 * #533, ADR-051): the Source-side twin of `pollExternalJobRun`, on the same
 * engine (`fetchExternalJobStatusFromEndpoint`, `decideSourceEnrichmentPoll` over the
 * shared `classifyJobPoll`).
 *
 * Every terminal outcome goes through `source_jobs.resumeAfterEnrichment`,
 * which ends the awaiting Run `resumed` and either resumes the SourceJob with a
 * new execution or, after a failure with nothing else to do, settles it.
 * Only a handoff that cannot be tied to one of the Agent's Sources (no or wrong
 * `job.sourceRef`) fails the Run, and with it the SourceJob.
 */
export async function pollSourceEnrichmentRun(
  ctx: ActionCtx,
  run: AwaitingJobRun,
  opts: { timedOut: boolean; maxMs: number },
): Promise<void> {
  const failRun = (message: string) =>
    ctx.runMutation(internal.runs.markFailed, { runId: run._id, code: "external_job_poll_failed", message });

  const jobType = run.mcpJob?.jobType;
  const jobId = run.mcpJob?.jobId;
  const sourceRef = run.mcpJob?.sourceRef;
  if (!run.mcpJob || jobId === undefined) {
    await failRun("awaiting_job run is missing its External Job pointer");
    return;
  }
  const source = sourceRef
    ? await ctx.runQuery(internal.sources.getForEnrichment, {
        sourceRef,
        instanceId: run.instanceId,
        templateId: run.templateId,
      })
    : null;
  if (!source) {
    await failRun(
      `The enrichment handoff must name a Source of this Agent in job.sourceRef (got ${JSON.stringify(sourceRef ?? null)})`,
    );
    return;
  }

  const resume = (outcome: EnrichmentOutcome) =>
    ctx.runMutation(internal.source_jobs.resumeAfterEnrichment, {
      runId: run._id,
      sourceRef: source._id,
      jobType,
      outcome,
    });

  // One resolution through the registry (installed Template first): the
  // polling contract and the MCP endpoint polled come from the same Template.
  const template = await getTemplateRegistry(ctx).resolve(run.instanceId, run.templateId);
  const contract = jobType !== undefined ? declaredEnrichment(template, source.sourceId)[jobType] : undefined;
  if (!template || !contract) {
    await resume({
      kind: "failed",
      sourceStatus: "failed",
      message: `Template "${run.templateId}" does not declare an enrichment "${jobType}" for Source "${source.sourceId}"`,
    });
    return;
  }

  let job: ExternalJobPollResult;
  try {
    const apiKey = await loadProjectAgentApiKey(ctx, run.instanceId, run.templateId);
    job = await fetchExternalJobStatusFromEndpoint({
      endpoint: resolveTemplateMcpEndpoint(template, contract.server, apiKey),
      contract,
      jobId,
    });
  } catch (err) {
    if (err instanceof TransientExternalJobPollError) {
      // Unreachable service: leave the Run awaiting; the timeout is the safety net.
      if (opts.timedOut) {
        await resume({ kind: "failed", sourceStatus: "failed", message: `Enrichment exceeded ${opts.maxMs} ms` });
      }
      return;
    }
    await resume({
      kind: "failed",
      sourceStatus: "failed",
      message: `External job status poll failed: ${errorMessage(err)}`,
    });
    return;
  }

  const decision = decideSourceEnrichmentPoll(job, contract, { maxMs: opts.maxMs }, opts.timedOut);
  if (decision.type === "wait") return;
  if (decision.type === "failed") {
    await resume({ kind: "failed", sourceStatus: decision.sourceStatus, message: decision.message });
    return;
  }
  await resume({ kind: "completed", output: decision.output });
}
