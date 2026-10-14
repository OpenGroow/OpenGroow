"use node";

import { composeAgentsMd } from "./mission_dispatcher/compose_agents_md.js";
import { flattenRequirementFields, openClawAgentSlug, renderRunContext } from "@opengroow/agent-templates";
import { internalAction } from "./_generated/server.js";
import type { ActionCtx } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import {
  RUNTIME_OPENCLAW_EXEC,
  RUNTIME_WORKSPACE_FILE_READ,
} from "@opengroow/protocol";
import { buildMissionContext } from "./mission_dispatcher/mission_context.js";
import { decideReconciliation, type ReconcileDecision } from "./mission_dispatcher/reconciliation.js";
import {
  appendContextProviders,
  CONTEXT_PROVIDER_RENDERERS,
  CONTEXT_PROVIDERS_REQUIRING_CONFIG,
  VALID_CONTEXT_PROVIDER_NAMES,
} from "./mission_dispatcher/context_providers.js";
import { getTemplateRegistry, runTemplateVersion } from "./template_registry.js";
import {
  computeRunMaxMs,
  computeSessionBudgetMs,
  runMaxMsFromSessionBudget,
} from "./mission_dispatcher/session_budget.js";
import { errorMessage } from "./mission_dispatcher/error_message.js";
import { jobRunFilePath } from "./source_jobs/job_files.js";
import { buildSourceJobRunFile } from "./source_jobs/source_job_context.js";
import { pollSourceEnrichmentRun } from "./source_jobs/enrichment_poll_node.js";
import { buildSourceScoringRunFile } from "./source_scoring.js";
import { buildSourceRoutingRunFile } from "./source_routing.js";
import { parentMissionId, type RunParent } from "./run_parent.js";
import { runOutputsFilePath } from "./mission_dispatcher/reconciliation.js";
import { resolveMissionTypeBlockerCodes } from "./mission_dispatcher/blocker_codes.js";
import { enqueueCommandMutation } from "./mission_dispatcher/enqueue_command.js";
import {
  pollExternalJobRun,
  normalizeExternalJobPollPayload,
} from "./mission_dispatcher/external_job_poll_node.js";
import {
  type ReconcileRun,
  sourceIdFromPayload,
} from "./mission_dispatcher/reconcile_apply_node.js";

export { computeRunMaxMs, normalizeExternalJobPollPayload, errorMessage };

export const MISSION_DISPATCHER_MAX_PER_TICK = 5;

// Extra grace period, on top of a Run's own `maxMs` watchdog, given to a
// salvage read of the workspace outputs file when the openclaw exec's own
// completion signal never arrives (its OS process can hang after finishing
// its work instead of exiting — a known upstream openclaw issue). The
// workspace read is a separate, lightweight operation decoupled from the
// stuck exec, so it should resolve quickly if the runtime is still healthy;
// this only bounds the pathological case where it also never comes back.
// Widened from 120s (incident k97ejvep5pvrthwygzk6tde3b98az5bb: the Agent's
// output file landed only ~6s before the old boundary) to shrink how often
// the final-read retry in decideReconciliation gets exercised at all — the
// retry itself is the real fix, this only reduces its frequency.
const SALVAGE_READ_GRACE_MS = 180_000;

function buildOpenClawExecCommandText(args: {
  agentName: string;
  sessionKey: string;
  runFilePath: string;
  outputsFilePath: string;
  timeoutMs: number;
}): string {
  const message = `Read ${args.runFilePath}. Follow the instructions there. On completion, write the RunResult to ${args.outputsFilePath}.`;
  const timeoutSec = Math.ceil(args.timeoutMs / 1000);
  return `openclaw agent --agent ${args.agentName} --session-id ${args.sessionKey} --message "${message}" --json --timeout ${timeoutSec}`;
}

export const tick = internalAction({
  args: {},
  handler: async (ctx) => {
    // External Job polling loop and Agent dispatch loop are kept separate
    // (ADR-020): launching a Run in OpenClaw and polling a job handed off by
    // the Agent are distinct responsibilities. Both share the scheduler
    // infrastructure but run as independent actions so neither can block the other.
    await ctx.runAction(internal.mission_dispatcher_node.pollExternalJobs, {});
    await ctx.runAction(internal.mission_dispatcher_node.reconcileRuns, {});
    await ctx.runAction(internal.mission_dispatcher_node.dispatchPendingRuns, {});
  },
});

/**
 * External Job polling loop (ADR-020, issue #145).
 * Separate from the Agent dispatch loop: this action ONLY polls `awaiting_job`
 * runs using the Template's declared `externalJob` REST polling contract.
 * It never dispatches new Runs or reconciles `running` Runs.
 */
export const pollExternalJobs = internalAction({
  args: {},
  handler: async (ctx) => {
    const registry = getTemplateRegistry(ctx);
    const runs = await ctx.runQuery(internal.mission_dispatcher.listRunsToReconcile, {});
    const now = Date.now();
    const isTimedOut = (dispatchedAt: number | undefined, maxMs: number) =>
      dispatchedAt !== undefined && now - dispatchedAt > maxMs;

    for (const r of runs) {
      if (r.status !== "awaiting_job") continue;
      const maxMs = await computeRunMaxMs(registry, r.instanceId, r.templateId, r.missionType, r.missionPayload);
      const opts = { timedOut: isTimedOut(r.dispatchedAt, maxMs), maxMs };
      // A Source ingestion Job execution's handoff is an enrichment of a Source (#533):
      // same polling engine, different meaning for a terminal state.
      const isSourceIngestion = r.parent.kind === "job"
        && await ctx.runQuery(internal.source_jobs.isSourceIngestionRun, { runId: r._id });
      if (isSourceIngestion) await pollSourceEnrichmentRun(ctx, r, opts);
      else if (r.parent.kind === "job"
        && (await ctx.runQuery(internal.score_jobs.isSourceScoringRun, { runId: r._id })
          || await ctx.runQuery(internal.source_routing.isSourceRoutingRun, { runId: r._id }))) continue;
      else await pollExternalJobRun(ctx, r, opts, registry);
    }
  },
});

export const reconcileRuns = internalAction({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.runQuery(internal.mission_dispatcher.listRunsToReconcile, {});
    const now = Date.now();
    for (const r of runs) {
      try {
        await reconcileRun(ctx, r, now);
      } catch (error) {
        // One Run's reconciliation failing (e.g. a transient Convex/runtime
        // error) must not stop the rest of the tick from being processed.
        console.error(`reconcileRuns: failed to reconcile run ${r._id}: ${errorMessage(error)}`);
      }
    }
  },
});

/** What enters the decision log: Sources are data, never logged (only their count, or a handoff's position). */
function loggedDecision(decision: ReconcileDecision) {
  if (decision.type === "ingestSources") {
    return { type: "ingestSources" as const, result: decision.result, sourceCount: decision.sources.length };
  }
  if (decision.type === "markAwaitingJob") return { type: "markAwaitingJob" as const, job: decision.job };
  return decision;
}

/**
 * Own the complete observe → decide → log → apply cycle for one Run.
 * `reconcileRuns` deliberately remains a scheduler: it only supplies the
 * current time and iterates eligible Runs. Keeping the Run locality here
 * prevents a future decision branch from being added without its persistence
 * and mutation effects.
 */
async function reconcileRun(ctx: ActionCtx, run: ReconcileRun, now: number): Promise<void> {
  const registry = getTemplateRegistry(ctx);
  const maxMs = await computeRunMaxMs(registry, run.instanceId, run.templateId, run.missionType, run.missionPayload);
  const isTimedOut = (limit: number) =>
    run.dispatchedAt !== undefined && now - run.dispatchedAt > limit;

  if (run.status === "dispatching") {
    if (isTimedOut(maxMs)) {
      await ctx.runMutation(internal.runs.markFailed, {
        runId: run._id,
        code: "timeout",
        message: `Run exceeded ${maxMs} ms`,
      });
    }
    return;
  }

  // External Job polling remains a separate loop (ADR-020).
  if (run.status === "awaiting_job") return;

  const state = await ctx.runQuery(internal.mission_dispatcher.loadReconcileState, {
    runId: run._id,
  });
  if (!state) return;

  const salvageTimedOut = isTimedOut(maxMs + SALVAGE_READ_GRACE_MS);
  const decision = decideReconciliation(
    {
      execResult: state.execResult,
      resultReadCommandId: state.resultReadCommandId as Id<"commands"> | null,
      readResult: state.readResult,
      workspaceKey: state.workspaceKey,
      timedOut: isTimedOut(maxMs),
      salvageTimedOut,
      finalReadCommandId: state.finalReadCommandId as Id<"commands"> | null,
      finalReadResult: state.finalReadResult,
      maxMs,
    },
    {
      parent: state.parent,
      sourceIngestion: state.sourceIngestion === true,
      sourceScoring: state.sourceScoring === true,
      sourceRouting: state.sourceRouting === true,
      runId: state.runId,
      missionType: state.missionType,
      blockerCodes: await resolveMissionTypeBlockerCodes(
        registry,
        run.instanceId,
        run.templateId,
        state.missionType,
        runTemplateVersion(run),
      ),
      retryableFailureCount: state.retryableFailureCount,
    },
  );

  await ctx.runMutation(internal.mission_dispatcher.recordReconcileDecision, {
    runId: state.runId,
    missionId: parentMissionId(state.parent),
    decision: loggedDecision(decision),
  });

  switch (decision.type) {
    case "wait":
      return;
    case "ingestSources":
      await ctx.runMutation(internal.runs.markCompleted, {
        runId: state.runId,
        result: decision.result,
        sources: decision.sources,
      });
      return;
    case "markFailed": {
      // A late decision racing an operator-initiated Stop (issue #482) is a
      // no-op inside `markFailed` (the Run is already `cancelled`).
      await ctx.runMutation(internal.runs.markFailed, {
        runId: state.runId,
        code: decision.code,
        message: decision.message,
        ...(decision.retryWithFeedback ? { retryWithFeedback: true } : {}),
      });
      return;
    }
    case "markFailedRetryable": {
      // The Agent's outputs.json failed the RunResult contract but the
      // invalid-output retry budget isn't exhausted (decideReconciliation):
      // resume the Mission with the error surfaced via context.md, mirroring
      // the External Job `onFail: "resume_mission"` path in
      // pollExternalJobRun/applyDecision above. Not terminal.
      await ctx.runMutation(internal.runs.markResumed, { runId: state.runId, intermediateResult: undefined });
      if (state.parent.kind === "mission") {
        await ctx.runMutation(internal.missions.resumeMissionAfterRetryableFailure, {
          missionId: state.parent.missionId,
          jobType: decision.jobType,
          error: decision.error,
          details: decision.details,
        });
      }
      return;
    }
    case "enqueueRead": {
      const enq = await ctx.runMutation(enqueueCommandMutation, {
        instanceId: state.instanceId,
        type: RUNTIME_WORKSPACE_FILE_READ,
        payload: { workspaceKey: state.workspaceKey, filePath: decision.filePath },
      });
      await ctx.runMutation(
        decision.role === "final"
          ? internal.mission_dispatcher.setFinalReadCommandId
          : internal.mission_dispatcher.setResultReadCommandId,
        { runId: state.runId, commandId: enq.commandId },
      );
      return;
    }
    case "markAwaitingJob":
      await ctx.runMutation(internal.runs.markAwaitingJob, {
        runId: state.runId,
        job: decision.job,
        ...(decision.sources ? { sources: decision.sources } : {}),
      });
      return;
    case "markCompleted": {
      const { applied } = await ctx.runMutation(internal.runs.markCompleted, {
        runId: state.runId,
        result: decision.result,
      });
      // A late exec result racing an operator-initiated Stop (issue #482):
      // markCompleted no-op'd against an already-`cancelled` Run, so the
      // RunResult-derived follow-ups below must not run.
      if (!applied) return;
      return;
    }
  }
}

export const dispatchPendingRuns = internalAction({
  args: {},
  handler: async (ctx) => {
    const registry = getTemplateRegistry(ctx);
    for (let i = 0; i < MISSION_DISPATCHER_MAX_PER_TICK; i++) {
      const claimed = await ctx.runMutation(internal.runs.claimNextPending, {});
      if (!claimed) return;

      if (claimed.parent.kind === "job"
        && await ctx.runQuery(internal.source_jobs.isSourceIngestionRun, { runId: claimed.runId })) {
        if (await dispatchSourceJobRun(ctx, claimed.runId, claimed.parent)) continue;
      }

      if (claimed.parent.kind === "job"
        && await ctx.runQuery(internal.score_jobs.isSourceScoringRun, { runId: claimed.runId })) {
        if (await dispatchSourceScoringRun(ctx, claimed.runId, claimed.parent)) continue;
      }

      if (claimed.parent.kind === "job"
        && await ctx.runQuery(internal.source_routing.isSourceRoutingRun, { runId: claimed.runId })) {
        if (await dispatchSourceRoutingRun(ctx, claimed.runId, claimed.parent)) continue;
      }

      const inputs = await ctx.runQuery(
        internal.mission_dispatcher.loadDispatchInputs,
        { runId: claimed.runId },
      );
      if (!inputs) {
        await ctx.runMutation(internal.runs.markFailed, {
          runId: claimed.runId,
          code: "dispatch_inputs_missing",
          message: "could not load mission/run/projectAgent",
        });
        continue;
      }

      const { mission, run, workspaceKey, config } = inputs;

      try {
        const template = await registry.resolve(mission.instanceId, mission.templateId);
        const runContext = template?.manifest.runContext;

        // Declarative context providers (issue #429): for each provider name
        // the Mission type declares, fetch the required data and let the pure
        // renderer append its section. The dispatcher never branches on a
        // specific templateId — only on provider name.
        //
        // A Mission type's own `contextProviders` (issue #454) takes
        // precedence over the Template-level list — a Template whose Mission
        // types have different information needs declares providers per
        // Mission type, so a Run never pays for a fetch (or fails a check) its
        // own Mission type doesn't use. The Template-level list remains the
        // fallback for a Template whose every Mission type genuinely needs the
        // same providers (Strategy's single Mission type).
        const missionTypeManifest = template?.manifest.missionTypes?.find(
          (mt) => mt.type === mission.type,
        );
        const contextProviders =
          missionTypeManifest?.contextProviders ?? template?.manifest.contextProviders;
        // A declarative run context needs no config by itself: only a Template
        // whose Agent cannot exist without config (a required requirement)
        // refuses to dispatch on an absent one. A provider reading the Agent's
        // config (platform-account) cannot run without it either.
        const requiresConfig =
          (contextProviders ?? []).some((name) => CONTEXT_PROVIDERS_REQUIRING_CONFIG.has(name))
          || (runContext !== undefined
            && flattenRequirementFields(template?.manifest.requirements).some((field) => field.required));
        if (requiresConfig) {
          if (!config || Object.keys(config).length === 0) {
            await ctx.runMutation(internal.runs.markFailed, {
              runId: claimed.runId,
              code: "dispatch_inputs_missing",
              message: `template ${mission.templateId} requires config but projectAgent.config is absent or empty`,
            });
            continue;
          }
        }
        const { contextMd: baseMd, runMd } = buildMissionContext(mission, run);
        let contextMd = baseMd;
        if (runContext) {
          contextMd += renderRunContext(runContext, {
            runId: run._id,
            config: config ?? {},
            secretConfigKeys: new Set(
              flattenRequirementFields(template?.manifest.requirements)
                .filter((field) => field.type === "password")
                .map((field) => field.key),
            ),
            payload: mission.payload as Record<string, unknown> | undefined,
            now: Date.now(),
          });
        }

        if (contextProviders && contextProviders.length > 0) {
          for (const name of contextProviders) {
            if (!VALID_CONTEXT_PROVIDER_NAMES.has(name)) {
              throw new Error(
                `Unknown context provider "${name}" in template "${template?.manifest.id}". ` +
                `Valid providers: ${[...VALID_CONTEXT_PROVIDER_NAMES].join(", ")}`,
              );
            }
          }
          const providerData: Record<string, unknown> = {};
          for (const name of contextProviders) {
            if (!(name in CONTEXT_PROVIDER_RENDERERS)) continue;
            if (name === "active-agents") {
              const activeAgents = await ctx.runQuery(
                internal.project_agents.listActiveByInstance,
                { instanceId: mission.instanceId },
              );
              providerData[name] = await Promise.all(activeAgents.map(async (pa) => {
                const tmpl = await registry.resolve(mission.instanceId, pa.templateId);
                const missionCapabilities = (tmpl?.manifest.missionTypes ?? []).map(
                  (mt) => mt.label ?? mt.type,
                );
                return {
                  templateId: pa.templateId,
                  name: pa.openclawAgentName ?? openClawAgentSlug(pa.templateId),
                  templateName: tmpl?.manifest.name ?? pa.templateId,
                  description: tmpl?.manifest.description ?? "",
                  capabilities: missionCapabilities,
                };
              }));
            }
            if (name === "platform-account") {
              providerData[name] = {
                runId: run._id,
                config: config ?? {},
                payload: mission.payload as Record<string, unknown> | undefined,
              };
            }
            if (name === "observation-production-source") {
              const observationId = sourceIdFromPayload(mission.payload);
              providerData[name] = observationId
                ? await ctx.runQuery(internal.observations_carousel_delegation.getCarouselPlanningContext, {
                    observationId,
                    instanceId: mission.instanceId,
                  })
                : null;
            }
          }
          contextMd = appendContextProviders(contextMd, contextProviders, providerData);
        }

        const contextPath = `missions/${mission._id}/context.md`;
        const runPath = `missions/${mission._id}/runs/${run._id}.md`;

        // These files are not enqueued as their own commands: the
        // Runtime Worker starts every command handler it receives without
        // awaiting the previous one (`void handleCommand(...)` in
        // openclaw-runtime-worker/src/index.ts), so separate write commands
        // would race the exec. Carried on the exec itself, they are written in
        // order immediately before the agent starts, and a failed write aborts
        // the exec into a failed Run instead of passing unnoticed.
        // Always restore AGENTS.md at dispatch time so a base-only Mission
        // cannot inherit the composed instructions of the previous Mission.
        const missionInstructions = template?.missionAgentsMd?.[mission.type];
        const missionInstructionsPath = template?.manifest.missionTypes?.find(
          (missionType) => missionType.type === mission.type,
        )?.agentsMd;
        const agentsMdContent = template
          ? composeAgentsMd(template.agentsMd, missionInstructions, missionInstructionsPath)
          : undefined;
        const filesToWrite = [
          { filePath: contextPath, content: contextMd },
          { filePath: runPath, content: runMd },
          ...(agentsMdContent === undefined
            ? []
            : [{ filePath: "AGENTS.md", content: agentsMdContent }]),
        ];

        // The run's `.session` state used to be pre-seeded here from this
        // budget. It never reached the Android plugin: that CLI runs on the
        // paired Mac node (the device is plugged into it) with its own working
        // directory, while the write landed in the runtime worker's workspace —
        // two different filesystems, so the CLI never read the file and fell
        // back to its own random ~600-630s budget (verified live 2026-08-18:
        // 300000ms written here vs. 622514ms in the file the CLI actually used,
        // whose Run was then killed by its hard watchdog mid-work with no
        // RunResult). The Agent now passes the real budget down itself via
        // `observe --session-duration-ms`. The budget still sizes the exec
        // timeout below.
        const sessionBudgetMs = await computeSessionBudgetMs(
          registry,
          mission.instanceId,
          mission.templateId,
          mission.type,
          mission.payload,
        );

        const outputsPath = `missions/${mission._id}/outputs/${run._id}.json`;
        const execTimeoutMs = runMaxMsFromSessionBudget(sessionBudgetMs);
        const commandText = buildOpenClawExecCommandText({
          agentName: run.agentName,
          sessionKey: run.sessionKey,
          runFilePath: runPath,
          outputsFilePath: outputsPath,
          timeoutMs: execTimeoutMs,
        });
        const execResult = await ctx.runMutation(enqueueCommandMutation, {
          instanceId: mission.instanceId,
          type: RUNTIME_OPENCLAW_EXEC,
          payload: {
            commandText,
            timeoutMs: execTimeoutMs,
            workspaceKey,
            filesToWrite,
            runFilePath: runPath,
            outputsFilePath: outputsPath,
          },
        });

        await ctx.runMutation(internal.runs.markRunning, {
          runId: run._id,
          dispatchCommandId: execResult.commandId,
          agentsMdSnapshot: agentsMdContent,
          contextMdSnapshot: contextMd,
        });
      } catch (err) {
        await ctx.runMutation(internal.runs.markFailed, {
          runId: run._id,
          code: "dispatch_failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  },
});

/**
 * Dispatch a SourceJob execution (a Run whose RunParent is a SourceJob, issue
 * #531): the context lists the merged schema of each of the Agent's Sources
 * and the batch. Returns false when the job is no longer dispatchable, so the
 * caller falls through to the Mission path (which fails it cleanly).
 */
async function dispatchSourceJobRun(
  ctx: ActionCtx,
  runId: Id<"runs">,
  parent: Extract<RunParent, { kind: "job" }>,
): Promise<boolean> {
  const inputs = await ctx.runQuery(internal.source_jobs.loadDispatchInputs, { runId });
  if (!inputs) return false;
  try {
    const template = await getTemplateRegistry(ctx).resolve(inputs.instanceId, inputs.templateId);
    const declarations = template?.manifest.sources ?? [];
    const runMd = buildSourceJobRunFile({
      declarations,
      batchRunIds: inputs.batch.runIds,
      batchRunMissionIds: inputs.batch.runMissionIds,
      retrySources: inputs.batch.retrySources,
      cursorAt: inputs.batch.cursorAt,
      boundAt: inputs.batch.boundAt,
      resumed: inputs.resumed,
      enrichment: inputs.enrichment,
      feedbackErrors: inputs.feedbackErrors,
      awaitingEnrichment: inputs.awaitingEnrichment,
    });
    const runPath = jobRunFilePath(parent.jobId);
    const outputsPath = runOutputsFilePath(parent, runId);
    const execTimeoutMs = runMaxMsFromSessionBudget(undefined);
    const filesToWrite = [
      { filePath: runPath, content: runMd },
      ...(template ? [{ filePath: "AGENTS.md", content: template.agentsMd }] : []),
    ];
    const execResult = await ctx.runMutation(enqueueCommandMutation, {
      instanceId: inputs.instanceId,
      type: RUNTIME_OPENCLAW_EXEC,
      payload: {
        commandText: buildOpenClawExecCommandText({
          agentName: inputs.run.agentName,
          sessionKey: inputs.run.sessionKey,
          runFilePath: runPath,
          outputsFilePath: outputsPath,
          timeoutMs: execTimeoutMs,
        }),
        timeoutMs: execTimeoutMs,
        workspaceKey: inputs.workspaceKey,
        filesToWrite,
        runFilePath: runPath,
        outputsFilePath: outputsPath,
      },
    });
    await ctx.runMutation(internal.runs.markRunning, {
      runId,
      dispatchCommandId: execResult.commandId,
      agentsMdSnapshot: template?.agentsMd,
      contextMdSnapshot: runMd,
    });
  } catch (err) {
    await ctx.runMutation(internal.runs.markFailed, {
      runId,
      code: "dispatch_failed",
      message: errorMessage(err),
    });
  }
  return true;
}

/** Dispatch a batched generic Source scoring Run. */
async function dispatchSourceScoringRun(
  ctx: ActionCtx,
  runId: Id<"runs">,
  parent: Extract<RunParent, { kind: "job" }>,
): Promise<boolean> {
  const inputs = await ctx.runQuery(internal.score_jobs.loadDispatchInputs, { runId });
  if (!inputs) return false;
  try {
    const template = await getTemplateRegistry(ctx).resolve(inputs.instanceId, inputs.templateId);
    const runMd = buildSourceScoringRunFile({ sources: inputs.sources, feedback: inputs.feedback });
    const runPath = jobRunFilePath(parent.jobId);
    const outputsPath = runOutputsFilePath(parent, runId);
    const execTimeoutMs = runMaxMsFromSessionBudget(undefined);
    const execResult = await ctx.runMutation(enqueueCommandMutation, {
      instanceId: inputs.instanceId,
      type: RUNTIME_OPENCLAW_EXEC,
      payload: {
        commandText: buildOpenClawExecCommandText({
          agentName: inputs.run.agentName,
          sessionKey: inputs.run.sessionKey,
          runFilePath: runPath,
          outputsFilePath: outputsPath,
          timeoutMs: execTimeoutMs,
        }),
        timeoutMs: execTimeoutMs,
        workspaceKey: inputs.workspaceKey,
        filesToWrite: [
          { filePath: runPath, content: runMd },
          ...(template ? [{ filePath: "AGENTS.md", content: template.agentsMd }] : []),
        ],
        runFilePath: runPath,
        outputsFilePath: outputsPath,
      },
    });
    await ctx.runMutation(internal.runs.markRunning, {
      runId,
      dispatchCommandId: execResult.commandId,
      agentsMdSnapshot: template?.agentsMd,
      contextMdSnapshot: runMd,
    });
  } catch (err) {
    await ctx.runMutation(internal.runs.markFailed, { runId, code: "dispatch_failed", message: errorMessage(err) });
  }
  return true;
}

/** Dispatch a Source routing Job Run to the Source Agent. */
async function dispatchSourceRoutingRun(
  ctx: ActionCtx,
  runId: Id<"runs">,
  parent: Extract<RunParent, { kind: "job" }>,
): Promise<boolean> {
  const inputs = await ctx.runQuery(internal.source_routing.loadDispatchInputs, { runId });
  if (!inputs) return false;
  try {
    const template = await getTemplateRegistry(ctx).resolve(inputs.instanceId, inputs.templateId);
    const runMd = buildSourceRoutingRunFile({ source: inputs.source, candidates: inputs.candidates, feedback: inputs.feedback });
    const runPath = jobRunFilePath(parent.jobId);
    const outputsPath = runOutputsFilePath(parent, runId);
    const execTimeoutMs = runMaxMsFromSessionBudget(undefined);
    const execResult = await ctx.runMutation(enqueueCommandMutation, {
      instanceId: inputs.instanceId,
      type: RUNTIME_OPENCLAW_EXEC,
      payload: {
        commandText: buildOpenClawExecCommandText({
          agentName: inputs.run.agentName,
          sessionKey: inputs.run.sessionKey,
          runFilePath: runPath,
          outputsFilePath: outputsPath,
          timeoutMs: execTimeoutMs,
        }),
        timeoutMs: execTimeoutMs,
        workspaceKey: inputs.workspaceKey,
        filesToWrite: [
          { filePath: runPath, content: runMd },
          ...(template ? [{ filePath: "AGENTS.md", content: template.agentsMd }] : []),
          ...(template?.jobInstructions?.source_routing
            ? [{ filePath: "jobs/source-routing.md", content: template.jobInstructions.source_routing }]
            : []),
        ],
        runFilePath: runPath,
        outputsFilePath: outputsPath,
      },
    });
    await ctx.runMutation(internal.runs.markRunning, {
      runId,
      dispatchCommandId: execResult.commandId,
      agentsMdSnapshot: template?.agentsMd,
      contextMdSnapshot: runMd,
    });
  } catch (err) {
    await ctx.runMutation(internal.runs.markFailed, { runId, code: "dispatch_failed", message: errorMessage(err) });
  }
  return true;
}
