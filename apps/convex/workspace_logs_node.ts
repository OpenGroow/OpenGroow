"use node";

import { action } from "./_generated/server.js";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api.js";
import type { FunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel.js";
import {
  RUNTIME_SESSION_TRANSCRIPT_READ,
  RUNTIME_SESSION_TRANSCRIPT_READ_RESULT,
} from "@opengroow/protocol";
import { enqueueInteractiveCommand, waitForRuntimeEvent } from "./runtime_commands_node.js";
import { runParent, type RunParent } from "./run_parent.js";
import { requireOwnerOfInstance } from "./instance_ownership.js";

const SESSION_TRANSCRIPT_TIMEOUT_MS = 30_000;

/**
 * Validates the `RuntimeSessionTranscriptReadResultPayload` shape at the
 * seam where it crosses from the control socket (a separate JS file in the
 * OpenClaw Docker image) into Convex. A shape drift on that side now fails
 * loudly here instead of silently producing an empty `turns: []`.
 *
 * A "turn" is one of three kinds, discriminated by `kind`: a conversational
 * `message` (as before), or a `tool_call`/`tool_result` pair surfacing what
 * was actually sent to/received from an MCP server (or any other tool) —
 * added so a Mission's Agent Logs can be used to debug why a tool (e.g.
 * `carousel-mcp.create_carousel`) produced what it produced, not just what
 * the agent said in between.
 */
const transcriptTurnZ = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("message"),
    role: z.enum(["user", "assistant"]),
    text: z.string(),
    timestamp: z.string().optional(),
  }),
  z.object({
    kind: z.literal("tool_call"),
    toolName: z.string(),
    // `.optional()` is load-bearing under zod v4: a bare `z.unknown()` object
    // key was optional at runtime in v3 but is required in v4, which would
    // reject a whole transcript over one turn that omits `arguments`.
    arguments: z.unknown().optional(),
    timestamp: z.string().optional(),
  }),
  z.object({
    kind: z.literal("tool_result"),
    toolName: z.string(),
    success: z.boolean(),
    result: z.unknown().optional(),
    timestamp: z.string().optional(),
  }),
]);
const transcriptReadResultPayloadZ = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  data: z.object({
    found: z.boolean(),
    turns: z.array(transcriptTurnZ),
  }),
});

export type SessionTranscriptTurn = z.infer<typeof transcriptTurnZ>;

export type WorkspaceRunTranscriptResult = {
  /** False when the selected Run has not produced a session yet — not an
   * error, an empty state. */
  found: boolean;
  turns: SessionTranscriptTurn[];
  /** The Run this transcript belongs to — set whenever a Run was resolved
   * (explicitly requested, or picked as "latest"), so the caller can
   * highlight/expand the right Mission → Run in the UI. */
  runId?: Id<"runs">;
  /** What that Run is attached to (RunParent) — set alongside `runId`. */
  parent?: RunParent;
};

type StoredProjectAgent = {
  templateId?: string;
  workspaceKey?: string;
  openclawAgentName?: string;
};

type StoredRun = {
  _id: Id<"runs">;
  missionId?: Id<"missions">;
  jobId?: Id<"jobs">;
  instanceId: string;
  templateId: string;
  agentName: string;
  sessionKey: string;
  createdAt: number;
};

const getProjectAgentByInstanceAndWorkspaceKeyQuery = internal.project_agents
  .getByInstanceAndWorkspaceKey as unknown as FunctionReference<
  "query",
  "internal",
  { instanceId: string; workspaceKey: string },
  StoredProjectAgent | null
>;

const getRunByIdQuery = internal.runs.getByIdInternal as unknown as FunctionReference<
  "query",
  "internal",
  { runId: Id<"runs"> },
  StoredRun | null
>;

const getLatestRunByInstanceTemplateQuery = internal.runs
  .getLatestByInstanceTemplate as unknown as FunctionReference<
  "query",
  "internal",
  { instanceId: string; templateId: string },
  StoredRun | null
>;

/**
 * Reads a Run's session transcript for the Agent that owns a given Workspace
 * (ADR-025). When `runId` is omitted, the most recently created Run for that
 * Agent is used — preserving the #230 "latest run" default. `sessionKey`
 * never leaves this action: it's resolved server-side from the Run record
 * and only used to address the runtime's read command; only the parsed turns
 * (plus the resolved `runId`/`missionId`, both safe domain identifiers) are
 * returned to the caller.
 */
export const getWorkspaceRunTranscript = action({
  args: {
    instanceId: v.string(),
    workspaceKey: v.string(),
    runId: v.optional(v.id("runs")),
  },
  handler: async (ctx, args): Promise<WorkspaceRunTranscriptResult> => {
    await requireOwnerOfInstance(ctx, args.instanceId);

    // When a specific Run is requested, its lookup doesn't depend on the
    // projectAgent resolution (only the ownership cross-check below does), so
    // the two reads run concurrently to save a round trip on the hot "click a
    // Run" path. The "latest Run" fallback does depend on `templateId`, so it
    // stays sequential.
    const [projectAgent, requestedRun] = await Promise.all([
      ctx.runQuery(getProjectAgentByInstanceAndWorkspaceKeyQuery, {
        instanceId: args.instanceId,
        workspaceKey: args.workspaceKey,
      }),
      args.runId ? ctx.runQuery(getRunByIdQuery, { runId: args.runId }) : Promise.resolve(null),
    ]);
    const templateId = projectAgent?.templateId;
    if (!templateId) {
      // No Agent owns this workspace (yet) — treat as "nothing to show" rather
      // than an error, same as an Agent that has never run.
      return { found: false, turns: [] };
    }

    const run = args.runId
      ? requestedRun
      : await ctx.runQuery(getLatestRunByInstanceTemplateQuery, {
          instanceId: args.instanceId,
          templateId,
        });

    // Defence in depth: a runId must actually belong to this Workspace's
    // Agent, never just any Run the caller happens to know the id of.
    if (!run || run.instanceId !== args.instanceId || run.templateId !== templateId) {
      return { found: false, turns: [] };
    }

    const parent = runParent(run);
    const dispatch = await enqueueInteractiveCommand(ctx, {
      instanceId: args.instanceId,
      type: RUNTIME_SESSION_TRANSCRIPT_READ,
      payload: { agentName: run.agentName, sessionKey: run.sessionKey },
    });
    if (!dispatch.commandId) {
      throw new Error("Failed to dispatch session transcript read command");
    }

    const brokerResult = await waitForRuntimeEvent(
      ctx,
      args.instanceId,
      dispatch.commandId,
      SESSION_TRANSCRIPT_TIMEOUT_MS,
    );
    if (!brokerResult.found) {
      throw new Error("Reading the session transcript timed out or failed");
    }
    if (brokerResult.type !== RUNTIME_SESSION_TRANSCRIPT_READ_RESULT) {
      throw new Error(
        `Unexpected session transcript command result type: ${brokerResult.type ?? "unknown"}`,
      );
    }

    const parsedPayload = transcriptReadResultPayloadZ.safeParse(brokerResult.payload);
    if (!parsedPayload.success) {
      throw new Error(`Malformed session transcript payload: ${parsedPayload.error.message}`);
    }
    const payload = parsedPayload.data;
    if (!payload.ok) {
      throw new Error(payload.error ?? "Session transcript read failed");
    }
    return {
      found: payload.data.found,
      turns: payload.data.turns,
      runId: run._id,
      parent,
    };
  },
});
