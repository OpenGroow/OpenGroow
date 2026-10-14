import type { ActionCtx } from "../_generated/server.js";
import { internal } from "../_generated/api.js";
import type { Id } from "../_generated/dataModel.js";
import { RUNTIME_WORKSPACE_FILE_READ } from "@opengroow/protocol";
import { decideExternalJobPoll } from "./external_job_polling.js";
import { resolveTemplateMcpEndpoint } from "../mcp_endpoint.js";
import {
  resolveExternalJobContract as resolveExternalJobContractFromManifest,
} from "@opengroow/agent-templates";
import type {
  AgentTemplate,
  ExternalJobPollingContract,
  ExternalJobPollingCore,
} from "@opengroow/agent-templates";
import type { TemplateRegistry } from "@opengroow/agent-templates/registry";
import { runTemplateVersion } from "../template_registry.js";
import { callMcpTool } from "../mcp_node.js";
import { errorMessage } from "./error_message.js";
import { validateTerminalRunResult } from "./blocker_codes.js";
import { parentMissionId, type RunParent } from "../run_parent.js";

const MCP_JOB_STATUS_TIMEOUT_MS = 30_000;

export class TransientExternalJobPollError extends Error {
  constructor(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(message);
    this.name = "TransientExternalJobPollError";
  }
}

function isTransientMcpStatusPollFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return true;
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) return true;
  return /ECONN|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|aborted/i.test(err.message);
}

/**
 * One External Job poll, normalized to the shape `decideExternalJobPoll`
 * consumes — every service's own response is reduced to this before any
 * decision is taken.
 */
export type ExternalJobPollResult = {
  status: string;
  error?: string;
  output?: Record<string, unknown>;
};

/**
 * Some External Job services (e.g. a video MCP's `get_run_status`) surface
 * an async render-step failure — a 400 from a downstream service like the
 * Letter renderer rejecting an over-length title — as an MCP tool-call error
 * (`callMcpTool` in mcp_node.ts throws `MCP tool error in <tool>: <text>`)
 * instead of a normal 200 response with a "failed" status field. Left as-is,
 * that exception would hit `fetchExternalJobStatusFromEndpoint`'s catch and go straight
 * to a permanent `markFailed`, bypassing `decideExternalJobPoll` (and its
 * `onFail: "resume_mission"` retry path) entirely.
 *
 * This recovers the job's actual terminal status from that error text when
 * the tool's own error payload embeds one (`{ isError, details: { status } }`
 * — the shape a video MCP uses), so the failure flows through
 * `decideExternalJobPoll` like any other declared-failed status instead of
 * being treated as a poll-transport failure. Returns null for anything that
 * doesn't match — genuine poll failures (bad JSON, missing fields) still fall
 * through to the caller's permanent-failure path unchanged.
 */
function tryRecoverJobFailureFromToolError(err: unknown): ExternalJobPollResult | null {
  if (!(err instanceof Error)) return null;
  const match = /^MCP tool error in [^:]+: ([\s\S]+)$/.exec(err.message);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  if (p.isError !== true) return null;
  const details = p.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const status = (details as Record<string, unknown>).status;
  if (typeof status !== "string" || status === "") return null;
  return {
    status,
    error: typeof p.message === "string" ? p.message : undefined,
    output: details as Record<string, unknown>,
  };
}

/**
 * Look up the Template's declared External Job polling contract for a
 * (missionType, jobType) pair, returning it with the (now known present)
 * Template. Throws a permanent (non-transient) error if the Template is
 * missing or has no `externalJobsByMissionType[missionType][jobType]`
 * declaration — this is a misconfiguration that should fail the run
 * immediately.
 */
function resolveExternalJobContract(
  template: AgentTemplate | undefined,
  templateId: string,
  missionType: string,
  jobType: string | undefined,
): { template: AgentTemplate; contract: ExternalJobPollingContract } {
  if (!template) throw new Error(`Template not found: ${templateId}`);
  const contract = resolveExternalJobContractFromManifest(template.manifest, missionType, jobType);
  if (!contract) {
    throw new Error(
      `Template "${templateId}" does not declare an External Job polling contract for mission type "${missionType}" and job type "${jobType}"`,
    );
  }
  return { template, contract };
}

export async function loadProjectAgentApiKey(
  ctx: ActionCtx,
  instanceId: string,
  templateId: string,
): Promise<string | undefined> {
  const projectAgent = await ctx.runQuery(
    internal.project_agents.getByInstanceAndTemplate,
    { instanceId, templateId },
  );
  const apiKey = projectAgent?.config?.apiKey;
  return typeof apiKey === "string" && apiKey.length > 0 ? apiKey : undefined;
}

/**
 * Pure normalization of one raw MCP poll response into the generic
 * `{status, error, output}` shape `decideExternalJobPoll` consumes — the
 * outputIsRoot/object-error/success-fallback generalization added for
 * the analysis MCP (issue #455), kept as its own exported, side-effect-
 * free function so it's unit-testable without mocking an MCP call.
 *
 * - `status`: `contract.statusField`'s value when it's a string; otherwise,
 *   when the payload declares `success: false` (the analysis MCP never sets a
 *   status field on failure), falls back to `"failed"` — routing cleanly
 *   into `decideExternalJobPoll`'s `terminalStates.failed` instead of the
 *   generic "malformed status" branch. Every other service always sets its
 *   own status field, so this fallback never fires for them. Otherwise `""`
 *   (the pre-existing "malformed poll response" signal).
 * - `error`: a string `payload.error` passes through unchanged (every
 *   pre-existing service's shape); an object `payload.error` (the analysis MCP's
 *   `{code, message}`) becomes `message`, with `code` folded into
 *   `output.errorCode` so a Source's `unavailableErrorCodes` can
 *   distinguish `unavailable` from `failed` without a service-specific poll loop.
 * - `output`: `contract.outputIsRoot` means the whole payload body IS the
 *   output (the analysis MCP nests nothing — `raw`/`observation` sit at the top
 *   level, no `payload.output` wrapper); otherwise the conventional
 *   `payload.output` nesting every other service uses.
 */
export function normalizeExternalJobPollPayload(
  payload: Record<string, unknown>,
  contract: Pick<ExternalJobPollingContract, "statusField" | "outputIsRoot">,
): ExternalJobPollResult {
  const statusRaw = payload[contract.statusField];
  const errorField = payload["error"];
  const status =
    typeof statusRaw === "string" ? statusRaw : payload["success"] === false ? "failed" : "";

  let error: string | undefined;
  let errorCode: string | undefined;
  if (typeof errorField === "string") {
    error = errorField;
  } else if (errorField && typeof errorField === "object" && !Array.isArray(errorField)) {
    const e = errorField as Record<string, unknown>;
    error = typeof e.message === "string" ? e.message : undefined;
    errorCode = typeof e.code === "string" ? e.code : undefined;
  }

  const outputSource = contract.outputIsRoot ? payload : payload["output"];
  const output =
    outputSource && typeof outputSource === "object" && !Array.isArray(outputSource)
      ? (outputSource as Record<string, unknown>)
      : undefined;

  return {
    status,
    error,
    output: errorCode !== undefined ? { ...(output ?? {}), errorCode } : output,
  };
}

/**
 * Poll one External Job's status via the Template's declared MCP tool.
 * Calls `contract.mcpTool` on the MCP server with `{ runId: jobId }` and
 * extracts the status from `contract.statusField`.
 *
 * Status polling uses MCP tool calling because that is the only status
 * channel the service exposes (no REST status endpoint). The Agent started
 * the job via MCP; OpenGroow polls it via the same channel here.
 *
 * Returns the status string and any error text. Throws a
 * `TransientExternalJobPollError` if the service is unreachable so callers
 * leave the run for a later tick. Throws a permanent error for non-transient
 * failures (misconfiguration, bad response shape).
 *
 * The endpoint comes from a Template the caller resolved through the registry
 * (`resolveTemplateMcpEndpoint`), never from the built-in Templates directly.
 */
export async function fetchExternalJobStatusFromEndpoint(opts: {
  endpoint: { mcpUrl: string; headers: Record<string, string> };
  contract: ExternalJobPollingCore;
  jobId: string;
}): Promise<ExternalJobPollResult> {
  const { mcpUrl, headers } = opts.endpoint;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MCP_JOB_STATUS_TIMEOUT_MS);
  try {
    const raw = await callMcpTool(
      mcpUrl,
      opts.contract.mcpTool,
      { runId: opts.jobId },
      { headers, signal: controller.signal },
    );
    return normalizeExternalJobPollPayload((raw ?? {}) as Record<string, unknown>, opts.contract);
  } catch (err) {
    if (isTransientMcpStatusPollFailure(err)) {
      throw new TransientExternalJobPollError(err);
    }
    const recovered = tryRecoverJobFailureFromToolError(err);
    if (recovered) return recovered;
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export type AwaitingJobRun = {
  _id: Id<"runs">;
  parent: RunParent;
  instanceId: string;
  templateId: string;
  missionType: string;
  dispatchedAt?: number;
  missionPayload: unknown;
  // The Template version the parent Mission is pinned to (#651); absent on
  // Missions created before pinning (built-in Template) and on Job Runs.
  templateVersion?: string;
  // How many times this Mission has already been resumed after a retryable
  // External Job failure (`onFail: "resume_mission"`); feeds
  // decideExternalJobPoll's MAX_RETRYABLE_JOB_FAILURES cap.
  retryableFailureCount: number;
  mcpJob?: {
    serverName: string;
    jobId: string;
    summary: string;
    reviewQuestions: string[];
    // Optional to accommodate legacy Runs written before this field existed
    // (pre-#243); see the same note on `schema.ts`'s `runs.mcpJob.jobType`.
    jobType?: string;
    missionType?: string;
    // SourceJob execution only (issue #533): the Source this job enriches.
    sourceRef?: string;
  };
};

/**
 * Poll one `awaiting_job` run by calling the Template's declared External Job
 * polling REST endpoint (ADR-020, ADR-013). Resolves the run on terminal
 * states, tolerates transient outages, and enforces the run timeout budget.
 *
 * Uses the Template's `externalJob` polling contract rather than a hardcoded
 * MCP tool name. The contract declares: server, REST path (with {jobId}
 * interpolation), the response field that holds the status string, and how
 * terminal states map to RunResult / Mission transitions.
 */
export async function pollExternalJobRun(
  ctx: ActionCtx,
  run: AwaitingJobRun,
  opts: { timedOut: boolean; maxMs: number },
  registry: TemplateRegistry,
): Promise<void> {
  if (!run.mcpJob) {
    // Defensive: an awaiting_job run with no pointer can never resolve.
    await ctx.runMutation(internal.runs.markFailed, {
      runId: run._id,
      code: "runtime",
      message: "awaiting_job run is missing its External Job pointer",
    });
    return;
  }
  const { serverName, jobId, summary, reviewQuestions, jobType } = run.mcpJob;
  // A Mission's Run polls with the contract of the version the Mission was
  // created with; a Job's Run has no Mission and follows the current version.
  const templateVersion = runTemplateVersion(run);
  const applyDecision = async (decision: ReturnType<typeof decideExternalJobPoll>) => {
    const validatedDecision =
      decision.type === "markCompleted"
        ? await (async () => {
            const blockerError = await validateTerminalRunResult(
              registry,
              run.instanceId,
              decision.result,
              run.templateId,
              run.missionType,
              templateVersion,
            );
            return blockerError
              ? { type: "markFailed" as const, code: "file_invalid", message: blockerError }
              : decision;
          })()
        : decision;
    await ctx.runMutation(internal.mission_dispatcher.recordReconcileDecision, {
      runId: run._id,
      missionId: parentMissionId(run.parent),
      decision: validatedDecision,
    });
    if (validatedDecision.type === "wait") return;
    if (validatedDecision.type === "markFailed") {
      await ctx.runMutation(internal.runs.markFailed, {
        runId: run._id,
        code: validatedDecision.code,
        message: validatedDecision.message,
      });
      return;
    }
    if (validatedDecision.type === "markResumed") {
      // Intermediate External Job (ADR-026): this Run is done (never
      // re-polled) but produces no terminal RunResult. The Mission's own
      // status is untouched — resumeMission only writes lastIntermediateResult
      // and creates a new pending Run for the same Mission.
      await ctx.runMutation(internal.runs.markResumed, {
        runId: run._id,
        intermediateResult: { jobType: validatedDecision.jobType, output: validatedDecision.intermediateResult },
      });
      if (run.parent.kind === "mission") {
        await ctx.runMutation(internal.missions.resumeMission, {
          missionId: run.parent.missionId,
          intermediateResult: {
            jobType: validatedDecision.jobType,
            output: validatedDecision.intermediateResult,
          },
        });
      }
      return;
    }
    if (validatedDecision.type === "markFailedRetryable") {
      // A retryable External Job failure (`onFail: "resume_mission"`): same
      // shape as markResumed above, but for a failure — the error is surfaced
      // to the Agent via context.md so it can correct its Manifest and retry.
      await ctx.runMutation(internal.runs.markResumed, {
        runId: run._id,
        intermediateResult: {
          jobType: validatedDecision.jobType,
          error: validatedDecision.error,
          details: validatedDecision.details,
        },
      });
      if (run.parent.kind === "mission") {
        await ctx.runMutation(internal.missions.resumeMissionAfterRetryableFailure, {
          missionId: run.parent.missionId,
          jobType: validatedDecision.jobType,
          error: validatedDecision.error,
          details: validatedDecision.details,
        });
      }
      return;
    }
    await ctx.runMutation(internal.runs.markCompleted, {
      runId: run._id,
      result: validatedDecision.result,
    });
  };

  // Resolve the Template's declared polling contract.
  // A missing contract is a permanent misconfiguration — fail immediately
  // (no transient retry), do NOT corrupt the Mission. The registry lookup
  // stays outside the try: a failing read is not a misconfiguration, it
  // aborts this tick and the Run is polled again on the next one.
  const resolvedTemplate = await registry.resolve(run.instanceId, run.templateId, templateVersion);
  let template: AgentTemplate;
  let contract: ExternalJobPollingContract;
  try {
    ({ template, contract } = resolveExternalJobContract(
      resolvedTemplate,
      run.templateId,
      run.missionType,
      jobType,
    ));
  } catch (err) {
    await ctx.runMutation(internal.runs.markFailed, {
      runId: run._id,
      code: "external_job_poll_failed",
      message: `External Job poll misconfigured: ${errorMessage(err)}`,
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
      // The service was unreachable. Leave the run in awaiting_job so a
      // later tick retries; the timeout is the only safety net.
      if (opts.timedOut) {
        await applyDecision({ type: "markFailed", code: "timeout", message: `Run exceeded ${opts.maxMs} ms` });
      }
      return;
    }
    // Non-transient poll failure (e.g. bad response shape, 4xx from service).
    await ctx.runMutation(internal.runs.markFailed, {
      runId: run._id,
      code: "external_job_poll_failed",
      message: `External job status poll failed: ${errorMessage(err)}`,
    });
    return;
  }

  await applyDecision(
    decideExternalJobPoll(
      job,
      contract,
      {
        serverName,
        jobId,
        summary,
        reviewQuestions,
        maxMs: opts.maxMs,
        jobType,
        retryableFailureCount: run.retryableFailureCount,
      },
      opts.timedOut,
    ),
  );
}
