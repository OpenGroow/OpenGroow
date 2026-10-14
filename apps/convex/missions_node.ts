"use node";

import { action, internalAction, type ActionCtx } from "./_generated/server.js";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { interpolateReviewTemplate, resolveReviewContract } from "@opengroow/agent-templates";
import { getTemplateRegistry, resolveMissionTemplate } from "./template_registry.js";
import type { AgentTemplate } from "@opengroow/agent-templates";
import type { FunctionReference } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel.js";
import { indexingOutcomeZ } from "./indexing.js";
import {
  enqueueCommandMutation,
  enqueueInteractiveCommand,
  waitForRuntimeEvent,
} from "./runtime_commands_node.js";
import { RUNTIME_WORKSPACE_FILE_READ, RUNTIME_WORKSPACE_FILE_READ_RESULT, RUNTIME_OPENCLAW_EXEC_CANCEL } from "@opengroow/protocol";
import { parseRuntimeOpenClawExecCancelPayload } from "./runtime_commands_node_parsers.js";
import { resolveMcpActivationUrl } from "./mcp_activation_url.js";
import { errorMessage } from "./mission_dispatcher_node.js";
import {
  buildMissionReviewProjection,
  type MissionReviewProjection,
} from "./mission_review.js";

const REVIEW_CONTENT_TIMEOUT_MS = 30_000;
const WORKSPACE_REVIEW_TIMEOUT_MS = 30_000;

export const getReview = action({
  args: { missionId: v.id("missions") },
  handler: async (ctx, args): Promise<MissionReviewProjection> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    const mission: Doc<"missions"> | null = await ctx.runQuery(
      internal.missions.getByIdInternal,
      { missionId: args.missionId },
    );
    if (!mission) throw new Error("Mission not found");

    const ownerId = identity.subject ?? identity.tokenIdentifier;
    if (mission.ownerId !== ownerId) throw new Error("Forbidden");

    const template = await resolveMissionTemplate(getTemplateRegistry(ctx), mission);
    return buildMissionReviewProjection(template?.manifest, {
      status: mission.status,
      missionType: mission.type,
      lastResult: mission.lastResult,
    });
  },
});

type StoredProjectAgent = {
  config?: Record<string, unknown>;
  workspaceKey?: string;
};

const getProjectAgentByInstanceAndTemplateQuery = internal.project_agents
  .getByInstanceAndTemplate as unknown as FunctionReference<
  "query",
  "internal",
  { instanceId: string; templateId: string },
  StoredProjectAgent | null
>;

type StoredInstance = {
  openclawId?: string;
};

const getInstanceByJobIdQuery = internal.instances
  .getByJobId as unknown as FunctionReference<
  "query",
  "internal",
  { jobId: string },
  StoredInstance | null
>;

// ---------------------------------------------------------------------------
// Workspace artifact loading
// ---------------------------------------------------------------------------

/**
 * Load a workspace artifact by dispatching a workspace file-read runtime
 * command and waiting for the result. Used when `artifact.external.service`
 * is `"workspace"` and the file path is stored in `artifact.external.id`.
 */
async function loadWorkspaceArtifact(
  ctx: ActionCtx,
  mission: { instanceId: string; templateId: string },
): Promise<string> {
  // Resolve the instance's openclawId from the mission's instanceId (= jobId).
  const instance = await ctx.runQuery(getInstanceByJobIdQuery, {
    jobId: mission.instanceId,
  });
  if (!instance?.openclawId) {
    throw new Error("Project has no linked OpenClaw runtime — workspace unavailable");
  }
  const openclawId = instance.openclawId;

  // Resolve the workspaceKey from the ProjectAgent record.
  const projectAgent = await ctx.runQuery(getProjectAgentByInstanceAndTemplateQuery, {
    instanceId: mission.instanceId,
    templateId: mission.templateId,
  });
  if (!projectAgent?.workspaceKey) {
    throw new Error("No workspace key configured for this project agent");
  }
  const workspaceKey = projectAgent.workspaceKey;

  // Dispatch the workspace file-read command — the filePath comes from the
  // caller (artifact.external.id).
  const dispatch = await ctx.runMutation(enqueueCommandMutation, {
    instanceId: openclawId,
    type: RUNTIME_WORKSPACE_FILE_READ,
    payload: {
      workspaceKey,
      // filePath is passed in from the artifact id below; see caller.
    },
  });

  if (!dispatch.commandId) {
    throw new Error("Failed to dispatch workspace file-read command");
  }

  const brokerResult = await waitForRuntimeEvent(
    ctx,
    openclawId,
    dispatch.commandId as Id<"commands">,
    WORKSPACE_REVIEW_TIMEOUT_MS,
  );

  if (!brokerResult.found) {
    throw new Error("Workspace file-read timed out or failed");
  }
  if (brokerResult.type !== RUNTIME_WORKSPACE_FILE_READ_RESULT) {
    throw new Error(`Unexpected workspace command result type: ${brokerResult.type ?? "unknown"}`);
  }

  const payload = brokerResult.payload as Record<string, unknown> | undefined;
  if (!payload?.ok) {
    const err = typeof payload?.error === "string" ? payload.error : "Workspace file read failed";
    throw new Error(err);
  }
  const data = payload.data as Record<string, unknown> | undefined;
  const content = typeof data?.content === "string" ? data.content : undefined;
  if (content === undefined) {
    throw new Error("Workspace file read returned no content");
  }
  return content;
}

/**
 * Dispatch a workspace file-read command with a specific filePath, wait for
 * the result, and return the file content as a string.
 */
async function readWorkspaceFile(
  ctx: ActionCtx,
  openclawId: string,
  workspaceKey: string,
  filePath: string,
): Promise<string> {
  const dispatch = await ctx.runMutation(enqueueCommandMutation, {
    instanceId: openclawId,
    type: RUNTIME_WORKSPACE_FILE_READ,
    payload: { workspaceKey, filePath },
  });

  if (!dispatch.commandId) {
    throw new Error("Failed to dispatch workspace file-read command");
  }

  const brokerResult = await waitForRuntimeEvent(
    ctx,
    openclawId,
    dispatch.commandId as Id<"commands">,
    WORKSPACE_REVIEW_TIMEOUT_MS,
  );

  if (!brokerResult.found) {
    throw new Error("Workspace file-read timed out or failed");
  }
  if (brokerResult.type !== RUNTIME_WORKSPACE_FILE_READ_RESULT) {
    throw new Error(`Unexpected workspace command result type: ${brokerResult.type ?? "unknown"}`);
  }

  const payload = brokerResult.payload as Record<string, unknown> | undefined;
  if (!payload?.ok) {
    const err = typeof payload?.error === "string" ? payload.error : "Workspace file read failed";
    throw new Error(err);
  }
  const data = payload.data as Record<string, unknown> | undefined;
  const content = typeof data?.content === "string" ? data.content : undefined;
  if (content === undefined) {
    throw new Error("Workspace file read returned no content");
  }
  return content;
}

// ---------------------------------------------------------------------------
// Generic review content loading (ADR-020)
// ---------------------------------------------------------------------------

/**
 * Generic action: load the review content for a Mission using the Template's
 * declared review content contract. Verifies ownership, resolves the Template
 * and Artifact, fetches content from the external service, and returns a safe
 * render payload for the generic review renderer.
 *
 * Supports artifacts with `external` (new generic shape). When
 * `artifact.external.service === "workspace"`, the file is fetched from the
 * instance's OpenClaw workspace via the runtime command protocol (issue #185).
 */
export const loadReviewContent = action({
  args: { missionId: v.id("missions") },
  handler: async (ctx, args): Promise<{
    kind: "markdown" | "metadata" | "image" | "video";
    content: string;
    metadata: Record<string, string | number | boolean>;
    coverUrl?: string;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    const mission: Awaited<ReturnType<typeof ctx.runQuery<typeof internal.missions.getByIdInternal>>> =
      await ctx.runQuery(internal.missions.getByIdInternal, {
        missionId: args.missionId,
      });
    if (!mission) throw new Error("Mission not found");

    const ownerId = identity.subject ?? identity.tokenIdentifier;
    if (mission.ownerId !== ownerId) throw new Error("Forbidden");

    const lastResult: typeof mission.lastResult = mission.lastResult;
    const artifact =
      lastResult && "artifact" in lastResult ? lastResult.artifact : undefined;
    if (!artifact) throw new Error("No artifact available for this mission");

    // Resolve the external deliverable id from artifact.external.id (strict contract, ADR-020 / #146).
    const externalId = artifact.external?.id;
    if (!externalId || typeof externalId !== "string") {
      throw new Error("No external identifier found in artifact (artifact.external.id is required)");
    }

    // ---------------------------------------------------------------------------
    // Workspace artifact path (issue #185): service === "workspace" means the
    // deliverable lives in the instance's OpenClaw workspace. Read it via the
    // runtime command protocol rather than an MCP HTTP request.
    // ---------------------------------------------------------------------------
    if (artifact.external?.service === "workspace") {
      // mission.instanceId IS the OpenClaw ID — missions.create stores the
      // project/OpenClaw ID there and ownership uses by_openclaw_id.
      const openclawId = mission.instanceId;

      const projectAgent = await ctx.runQuery(getProjectAgentByInstanceAndTemplateQuery, {
        instanceId: openclawId,
        templateId: mission.templateId,
      });
      if (!projectAgent?.workspaceKey) {
        throw new Error("No workspace key configured for this project agent");
      }

      const content = await readWorkspaceFile(
        ctx,
        openclawId,
        projectAgent.workspaceKey,
        externalId,
      );

      return {
        kind: (artifact.kind ?? "metadata") as "markdown" | "metadata" | "image" | "video",
        content,
        metadata: (artifact.metadata ?? {}) as Record<string, string | number | boolean>,
      };
    }

    // ---------------------------------------------------------------------------
    // MCP server path: resolve the review contract declared by the Template.
    // ---------------------------------------------------------------------------
    const template = await resolveMissionTemplate(getTemplateRegistry(ctx), mission);
    if (!template) throw new Error(`Template not found: ${mission.templateId}`);

    const reviewContract = resolveReviewContract(template.manifest, mission.type);
    if (!reviewContract) {
      throw new Error(`Template ${mission.templateId} does not declare a review content contract`);
    }

    if (!("server" in reviewContract)) {
      throw new Error(
        `Template ${mission.templateId} declares a workspace review contract but artifact.external.service is not "workspace" — use the workspace code path instead`,
      );
    }

    // Resolve the MCP server config from the Template manifest.
    const server = template.manifest.mcpServers.find(
      (s) => s.name === reviewContract.server,
    );
    if (!server) {
      throw new Error(
        `Review server "${reviewContract.server}" not found in template manifest`,
      );
    }
    // Resolve the path with {id} interpolation.
    const path = reviewContract.path.replace("{id}", encodeURIComponent(externalId));

    const publicOrigin = new URL(server.publicBaseUrl ?? server.activationUrl ?? server.url).origin;
    const coverUrl = reviewContract.coverPath
      ? `${publicOrigin}${reviewContract.coverPath.replace("{id}", encodeURIComponent(externalId))}`
      : undefined;

    // For video content the URL is the deliverable itself (a media stream) —
    // returned directly for the *browser* to render in a <video> tag. That's a
    // different caller than the rest of this action (Convex fetching content
    // server-side), so it needs the server's browser-reachable address
    // (`publicBaseUrl`), not `resolveMcpActivationUrl`'s Docker-container-facing
    // one (e.g. `host.docker.internal`, which the user's own browser can't
    // resolve at all).
    if (reviewContract.kind === "video") {
      return {
        kind: "video" as const,
        content: `${publicOrigin}${path}`,
        metadata: (artifact.metadata ?? {}) as Record<string, string | number | boolean>,
        ...(coverUrl ? { coverUrl } : {}),
      };
    }

    const baseUrl = resolveMcpActivationUrl(server);
    const origin = new URL(baseUrl).origin;
    const url = `${origin}${path}`;

    // Fetch the apiKey from the ProjectAgent config.
    const projectAgent = await ctx.runQuery(getProjectAgentByInstanceAndTemplateQuery, {
      instanceId: mission.instanceId,
      templateId: mission.templateId,
    });
    const apiKeyRaw = projectAgent?.config?.apiKey;
    const apiKey =
      typeof apiKeyRaw === "string" && apiKeyRaw.length > 0 ? apiKeyRaw : undefined;

    const headers: Record<string, string> = {
      ...(server.headers ?? {}),
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REVIEW_CONTENT_TIMEOUT_MS);
    let content: string;
    try {
      const response = await fetch(url, { method: "GET", headers, signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Review content fetch failed: ${response.status} ${response.statusText}`);
      }
      const data = await response.json() as Record<string, unknown>;
      // Both legacy (content: string) and future shapes are supported.
      if (typeof data.content !== "string") {
        throw new Error("Review content response missing `content` field");
      }
      content = data.content;
    } finally {
      clearTimeout(timeout);
    }

    return {
      kind: reviewContract.kind,
      content,
      metadata: (artifact.metadata ?? {}) as Record<string, string | number | boolean>,
      ...(coverUrl ? { coverUrl } : {}),
    };
  },
});

// ---------------------------------------------------------------------------
// Generic review action execution (ADR-020)
// ---------------------------------------------------------------------------

const REVIEW_ACTION_TIMEOUT_MS = 120_000;

/**
 * Load a Mission and resolve its Template. Shared prologue of every
 * review-action entrypoint, so the load/resolve sequence — and its error
 * ordering and messages — lives here once.
 *
 * Carries no authorization: the human path (`performReviewAction`) checks
 * `mission.ownerId` against the caller's identity itself, right after
 * calling this; the automatic path (`autoPublishChain`) has no caller
 * identity to check at all (PRD: the auto-publish chain must not depend on
 * an authenticated Convex identity) and so skips that check entirely.
 */
async function loadMissionAndTemplate(
  ctx: ActionCtx,
  missionId: Id<"missions">,
): Promise<{ mission: Doc<"missions">; template: AgentTemplate }> {
  const mission = await ctx.runQuery(internal.missions.getByIdInternal, {
    missionId,
  });
  if (!mission) throw new Error("Mission not found");

  const template = await resolveMissionTemplate(getTemplateRegistry(ctx), mission);
  if (!template) throw new Error(`Template not found: ${mission.templateId}`);

  return { mission, template };
}

/**
 * Resolve a Template-declared review action's contract and execute its bounded
 * HTTP effect (or its `revision_run` effect) for a Mission, then apply the
 * declared Mission status transition.
 *
 * This is the effect-execution core shared by the human-driven path
 * (`performReviewAction`, which authenticates the caller first) and the
 * automatic path (`autoPublishChain`, triggered from `runs.markCompleted` —
 * issue #329), which has no authenticated Convex identity to check. It is
 * intentionally independent of `ctx.auth` — callers are responsible for
 * authorizing the request (or establishing that no authorization is needed)
 * before invoking this function.
 *
 * Validates Mission status, action existence, and input; executes the bounded
 * HTTP effect declared by the Template; then applies the declared Mission
 * status transition. Failed effects surface clear errors and do NOT corrupt
 * Mission state: the Mission transition runs only after a successful HTTP
 * effect.
 */
async function executeReviewAction(
  ctx: ActionCtx,
  params: {
    mission: Doc<"missions">;
    template: AgentTemplate;
    actionKey: string;
    input?: Record<string, string>;
  },
): Promise<{ ok: true }> {
  const { mission, template, actionKey, input } = params;

  const reviewContract = resolveReviewContract(template.manifest, mission.type);
  if (!reviewContract) {
    throw new Error(`Template ${mission.templateId} does not declare review actions`);
  }

  const actions = reviewContract.actions ?? [];
  const actionDef = actions.find((a) => a.key === actionKey);
  if (!actionDef) {
    throw new Error(
      `Action "${actionKey}" is not declared by template "${mission.templateId}"`,
    );
  }

  // --- Validate mission status ---
  if (mission.status !== actionDef.requiredStatus) {
    throw new Error(
      `Action "${actionKey}" requires mission in "${actionDef.requiredStatus}" status, got: "${mission.status}"`,
    );
  }

  // --- Validate required inputs ---
  const userInput = input ?? {};
  for (const inputDef of actionDef.inputs ?? []) {
    if (inputDef.required) {
      const val = userInput[inputDef.key];
      if (!val || val.trim() === "") {
        throw new Error(`Required input "${inputDef.key}" is missing or empty`);
      }
    }
  }

  // --- Handle revision_run effect (reject): no artifact resolution needed ---
  // The revision_run effect creates a new Run with human feedback and moves
  // the Mission back to "doing". The artifact is not needed for this path.
  const effect = actionDef.effect;
  if (effect && "kind" in effect && effect.kind === "revision_run") {
    const feedbackKey = effect.feedbackKey;
    const feedback = (userInput[feedbackKey] ?? "").trim();
    // Feedback non-emptiness is already enforced above by the required-input
    // validator (inputDef.required === true), but we guard here defensively.
    if (!feedback) {
      throw new Error(`Required input "${feedbackKey}" is missing or empty`);
    }

    const eventType = "ReviewRejected";

    await ctx.runMutation(internal.missions.rejectMission, {
      missionId: mission._id,
      ownerId: mission.ownerId,
      feedback,
      eventType,
    });

    return { ok: true };
  }

  // --- Resolve the Artifact external id ---
  const lastResult = mission.lastResult;
  const artifact =
    lastResult && "artifact" in lastResult ? lastResult.artifact : undefined;
  if (!artifact) {
    throw new Error("No artifact available for this mission");
  }

  // Resolve external id from artifact.external.id (strict contract, ADR-020 / #146).
  // Legacy metadata.articleId / metadata.runId paths have been removed.
  const externalId = artifact.external?.id;
  if (!externalId || typeof externalId !== "string") {
    throw new Error("No external identifier found in artifact (artifact.external.id is required)");
  }

  // --- Execute the bounded HTTP effect (if declared) ---
  let indexingOutcome: import("./indexing.js").IndexingOutcome | undefined;

  if (effect) {
    // At this point effect is guaranteed to be a BoundedHttpEffect (not revision_run)
    const httpEffect = effect as import("@opengroow/agent-templates").BoundedHttpEffect;

    // Resolve the MCP server config
    const server = template.manifest.mcpServers.find((s) => s.name === httpEffect.server);
    if (!server) {
      throw new Error(
        `Effect server "${httpEffect.server}" not found in template "${mission.templateId}" manifest`,
      );
    }
    const baseUrl = resolveMcpActivationUrl(server);
    const origin = new URL(baseUrl).origin;

    const missionPayload = (mission.payload ?? {}) as Record<string, unknown>;
    // Interpolate path: {id}, {input.<key>}, {payload.<key>} — URL-encode to prevent injection
    const pathValue = interpolateReviewTemplate(httpEffect.path, externalId, userInput, true, missionPayload);
    if (typeof pathValue !== "string") {
      throw new Error("Review action path interpolation must resolve to a string");
    }
    const path = pathValue;
    const url = `${origin}${path}`;

    // Resolve the apiKey from the ProjectAgent config
    const projectAgent = await ctx.runQuery(getProjectAgentByInstanceAndTemplateQuery, {
      instanceId: mission.instanceId,
      templateId: mission.templateId,
    });
    const apiKeyRaw = projectAgent?.config?.apiKey;
    const apiKey =
      typeof apiKeyRaw === "string" && apiKeyRaw.length > 0 ? apiKeyRaw : undefined;

    const headers: Record<string, string> = {
      ...(server.headers ?? {}),
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      "Content-Type": "application/json",
    };

    // Interpolate and build the request body (if declared)
    let body: string | undefined;
    if (httpEffect.body) {
      const resolved: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(httpEffect.body)) {
        const interpolated = interpolateReviewTemplate(v, externalId, userInput, false, missionPayload);
        // Omit empty optional inputs rather than sending empty string
        if (interpolated !== "") {
          resolved[k] = interpolated;
        }
      }
      body = JSON.stringify(resolved);
    }

    // Execute the HTTP effect with a timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REVIEW_ACTION_TIMEOUT_MS);
    let responseData: Record<string, unknown> = {};
    try {
      const response = await fetch(url, {
        method: httpEffect.method,
        headers,
        ...(body !== undefined ? { body } : {}),
        signal: controller.signal,
      });
      if (!response.ok) {
        let errorDetail = "";
        try {
          const errBody = (await response.json()) as Record<string, unknown>;
          const detail = errBody.details ?? errBody.error;
          if (detail !== undefined) {
            errorDetail = ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
          }
        } catch {
          // Body may not be JSON
        }
        throw new Error(
          `Action "${actionKey}" effect failed: ${response.status} ${response.statusText}${errorDetail}`,
        );
      }
      if (httpEffect.responseIndexingField) {
        try {
          responseData = (await response.json()) as Record<string, unknown>;
        } catch {
          // Response may not be JSON — treat as no indexing data
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    // Extract optional indexing outcome from response
    if (httpEffect.responseIndexingField) {
      const rawIndexing = responseData[httpEffect.responseIndexingField];
      if (rawIndexing !== undefined) {
        // The field is optional, but a present-but-malformed payload signals an
        // upstream contract regression — fail loudly rather than publish with
        // dropped indexing data.
        const parsed = indexingOutcomeZ.safeParse(rawIndexing);
        if (!parsed.success) {
          throw new Error(
            `Action "${actionKey}" effect returned an invalid indexing outcome`,
          );
        }
        indexingOutcome = parsed.data;
      }
    }
  }

  // --- Record a domain event before flipping mission state (idempotent) ---
  const eventType = actionDef.key === "approve" ? "ReviewApproved" : "ReviewPublished";
  await ctx.runMutation(internal.events.store, {
    instanceId: mission.instanceId,
    event: {
      id: `${eventType}:${mission._id}`,
      type: eventType,
      payload: {
        missionId: mission._id,
        templateId: mission.templateId,
        actionKey,
        externalId,
      },
      ts: Date.now(),
    },
  });

  // --- Apply the declared Mission transition ---
  if (actionDef.transition === "approved") {
    await ctx.runMutation(internal.missions.markApproved, { missionId: mission._id });
  } else {
    // "done" — pass indexing outcome if available
    await ctx.runMutation(internal.missions.markDone, {
      missionId: mission._id,
      ...(indexingOutcome !== undefined ? { indexing: indexingOutcome } : {}),
    });
  }

  return { ok: true };
}

/**
 * Generic action: execute a Template-declared review action capability
 * (approve or publish) for a Mission. Validates ownership, then delegates
 * contract resolution and effect execution to `executeReviewAction`.
 */
export const performReviewAction = action({
  args: {
    missionId: v.id("missions"),
    /** Canonical capability key: "approve" | "publish" */
    actionKey: v.string(),
    /**
     * Optional user-supplied inputs for the action.
     * Required inputs are validated against the Template's declared inputs.
     */
    input: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    const ownerId = identity.subject ?? identity.tokenIdentifier;
    const { mission, template } = await loadMissionAndTemplate(ctx, args.missionId);
    if (mission.ownerId !== ownerId) throw new Error("Forbidden");

    return executeReviewAction(ctx, {
      mission,
      template,
      actionKey: args.actionKey,
      input: args.input,
    });
  },
});

/**
 * Stop action (issue #482): kills the OpenClaw agent process for a Mission's
 * live Run, then moves both the Run and the Mission to the terminal
 * `cancelled` status. Guarded on the Mission actually being `doing` with a
 * live Run (`dispatching`/`running`/`awaiting_job`) — anything else fails
 * clearly instead of silently no-op'ing.
 *
 * The initial `getByIdInternal` read below is only a fast-fail/ownership
 * check — `missions.reserveCancellation` re-validates eligibility and finds
 * the live Run to target *atomically with* setting the Mission's
 * `cancelling` marker. That atomicity matters: it closes the race window
 * during the multi-second dispatch/wait round-trip below in which a
 * concurrent External Job resume
 * (`missions.resumeMission`/`resumeMissionAfterRetryableFailure`) could
 * otherwise land — either fully before `reserveCancellation` (which then
 * correctly targets the resulting new live Run) or fully after (blocked by
 * `cancelling`), never racing against a stale live-Run reference read
 * earlier in this action. See `reserveCancellation`'s doc comment.
 *
 * On dispatch failure, timeout, or an explicit failure result from the
 * gateway/worker, this throws and leaves the Mission/Run untouched at their
 * current (non-terminal) status (aside from the `cancelling` marker, which
 * stays set — the Mission is still non-`doing`-resumable until the operator
 * retries Stop or the Run naturally completes) — the dashboard's Stop button
 * stays available so the operator can retry once connectivity is restored.
 */
export const cancelMission = action({
  args: { missionId: v.id("missions") },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    const mission: Doc<"missions"> | null = await ctx.runQuery(internal.missions.getByIdInternal, {
      missionId: args.missionId,
    });
    if (!mission) throw new Error("Mission not found");

    const ownerId = identity.subject ?? identity.tokenIdentifier;
    if (mission.ownerId !== ownerId) throw new Error("Forbidden");

    // Reserves cancellation intent and re-validates eligibility atomically —
    // see this action's doc comment for why this can't be a separate read
    // followed by a separate `cancelling` write.
    const liveRun: Doc<"runs"> | null = await ctx.runMutation(
      internal.missions.reserveCancellation,
      { missionId: args.missionId },
    );
    if (!liveRun) {
      throw new Error("Mission is not currently running");
    }

    const dispatch = await enqueueInteractiveCommand(ctx, {
      instanceId: mission.instanceId,
      type: RUNTIME_OPENCLAW_EXEC_CANCEL,
      payload: { sessionId: liveRun.sessionKey },
    });
    if (!dispatch.accepted) {
      throw new Error("Failed to dispatch the cancel command to the Project's runtime");
    }

    const brokerResult = await waitForRuntimeEvent(
      ctx,
      mission.instanceId,
      dispatch.commandId,
    );
    if (!brokerResult.found) {
      throw new Error("Runtime cancel command timed out");
    }

    const parsed = parseRuntimeOpenClawExecCancelPayload(
      brokerResult.type,
      brokerResult.payload,
    );
    if (!parsed || !parsed.ok) {
      throw new Error(parsed?.error ?? "Failed to stop mission");
    }

    await ctx.runMutation(internal.runs.markCancelled, { runId: liveRun._id });

    return { ok: true };
  },
});

/**
 * Automatic approve → publish chain (issue #329), scheduled from
 * `runs.markCompleted` (zero-delay, `ctx.scheduler.runAfter(0, ...)`) when a
 * Run ends `needs_human_review` on a Mission with `autoPublish === true`.
 *
 * Sequencing is mandatory: the `approve` action always runs before the
 * `publish` action — never a direct jump to publish — because the external
 * MCP server cannot be assumed to accept a publish without a prior approve.
 * Both steps delegate to the same `executeReviewAction` used by the
 * human-driven `performReviewAction`, so the automatic path can never
 * silently diverge from the manual one.
 *
 * No `ctx.auth` / identity check anywhere in this path — the PRD requires
 * the automatic chain to not depend on an authenticated Convex identity.
 * No retry: any effect failure marks the Mission `failed` immediately via
 * `internal.missions.markFailed` and stops the chain (publish is never
 * invoked if approve failed; a failed publish leaves the Mission `failed`
 * without losing the `approved` transition that already happened).
 */
export const autoPublishChain = internalAction({
  args: { missionId: v.id("missions") },
  handler: async (ctx, args): Promise<void> => {
    // No ownership check — the chain acts on the Mission's own behalf, with
    // no caller identity to authorize (PRD: no authenticated identity
    // required).
    const { mission, template } = await loadMissionAndTemplate(ctx, args.missionId);

    const failMission = (message: string) =>
      ctx.runMutation(internal.missions.markFailed, {
        missionId: args.missionId,
        errorMessage: `autoPublish: ${message}`,
      });

    /**
     * Run one step of the chain, marking the Mission `failed` and stopping
     * the chain (returns false) if the effect throws. A failed step never
     * rolls back a previous successful transition. No separate "does this
     * template support the full flow" precheck: `executeReviewAction`
     * already throws a clear "Action ... is not declared" error when the
     * template has no `approve`/`publish` action, which this catches — the
     * same error the human path (`performReviewAction`) would surface for
     * the same template, per the PRD's "no special behavior for this case".
     */
    // `actionKey` is always the canonical capability key ("approve" /
    // "publish"), never resolved by `requiredStatus`: `reject` is also
    // gated on "to_validate", so matching on status alone could fire the
    // revision_run effect instead of approving.
    const runStep = async (
      actionKey: "approve" | "publish",
      missionDoc: Doc<"missions">,
    ): Promise<boolean> => {
      try {
        await executeReviewAction(ctx, { mission: missionDoc, template, actionKey });
        return true;
      } catch (err) {
        await failMission(`${actionKey} step failed — ${errorMessage(err)}`);
        return false;
      }
    };

    if (!(await runStep("approve", mission))) return;

    // Re-fetch: the approve step above already patched the Mission's status
    // (and possibly other fields) in the DB — executeReviewAction needs the
    // post-approve Mission doc to validate the publish action's required
    // status ("approved").
    const approvedMission = await ctx.runQuery(internal.missions.getByIdInternal, {
      missionId: args.missionId,
    });
    if (!approvedMission) throw new Error("Mission not found after approve step");

    await runStep("publish", approvedMission);
  },
});

