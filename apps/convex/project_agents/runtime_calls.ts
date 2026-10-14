import type { ActionCtx } from "../_generated/server.js";
import type { Id } from "../_generated/dataModel.js";
import { internal } from "../_generated/api.js";
import {
  RUNTIME_COMMAND_UNSUPPORTED,
  RUNTIME_OPENCLAW_EXEC_RESULT,
  type RuntimeOpenClawExecResultPayload,
} from "@opengroow/protocol";
import { enqueueCommandMutation, enqueueInteractiveCommand, waitForRuntimeEvent, type RuntimeResultQueryResult } from "../runtime_commands_node.js";
import { env } from "../env.js";

/**
 * Dispatch a runtime command to the Agent's instance and wait for its
 * matching result event. Shared by every OpenClaw provisioning call
 * (workspace create/list/delete, MCP server merge/remove, `openclaw`/`clawhub`
 * exec) so they all use the same broker round-trip and timeout.
 */
export async function sendAndAwait(
  ctx: ActionCtx,
  instanceId: string,
  type: string,
  payload: unknown,
  timeoutMs: number = env.ACTIVATION_BROKER_TIMEOUT_MS,
): Promise<RuntimeResultQueryResult> {
  const dispatch = await enqueueInteractiveCommand(ctx, {
    instanceId,
    type,
    payload,
  });
  return await waitForRuntimeEvent(
    ctx,
    instanceId,
    dispatch.commandId as Id<"commands">,
    timeoutMs,
  );
}

/**
 * Per-step budget carried by every compound command, matching the Runtime
 * Worker's own default (`DEFAULT_STEP_TIMEOUT_MS` in compound-commands.ts).
 */
export const COMPOUND_STEP_TIMEOUT_MS = 120_000;

/**
 * How long to wait for a compound command running `steps` sequential steps.
 * The default activation timeout only covers a single round-trip; a compound
 * command whose steps legitimately add up to more than that would otherwise
 * be abandoned mid-flight while the Worker keeps running it.
 */
export function compoundWaitMs(steps: number): number {
  return steps * COMPOUND_STEP_TIMEOUT_MS + env.ACTIVATION_BROKER_TIMEOUT_MS;
}

/**
 * Whether a compound command was not understood by the fleet, so the caller
 * must fall back to the individual commands it replaces (issue #447). During
 * a gradual rollout Convex can be ahead of the Broker or of a Runtime Worker,
 * and each layer signals it differently:
 *
 * - a newer Worker with no handler answers `runtime.command.unsupported`;
 * - an older Broker rejects the unknown command type with a 400, which
 *   `commands_node.dispatch` turns into a failed command (status 500 here);
 * - an older Worker drops the message at wire validation without answering
 *   at all, which can only ever surface as the wait timing out (504).
 *
 * Every fallback sequence below is safe to run after a timeout: it re-reads
 * the live state (`agents list`) or is idempotent (`clawhub install` reports
 * an already-present skill as installed).
 */
export function isCompoundUnsupported(result: RuntimeResultQueryResult): boolean {
  if (result.type === RUNTIME_COMMAND_UNSUPPORTED) return true;
  return !result.found && (result.status === 504 || result.status === 500);
}

/**
 * Enqueue multiple commands as a deferred batch and dispatch them in a single
 * HMAC-signed HTTP POST to the Broker's `/broker/commands/batch` endpoint.
 * Results are awaited in parallel.
 */
export async function sendBatchAndAwait(
  ctx: ActionCtx,
  instanceId: string,
  commands: Array<{ type: string; payload: unknown }>,
): Promise<RuntimeResultQueryResult[]> {
  const enqueueBatch = internal.commands.enqueueBatch;
  const result = await ctx.runMutation(enqueueBatch, {
    commands: commands.map((cmd) => ({ instanceId, type: cmd.type, payload: cmd.payload })),
  });
  const commandIds = result.commandIds as Id<"commands">[];
  return await Promise.all(
    commandIds.map((commandId) =>
      waitForRuntimeEvent(ctx, instanceId, commandId, env.ACTIVATION_BROKER_TIMEOUT_MS),
    ),
  );
}

export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function parseOpenClawExecResult(
  result: RuntimeResultQueryResult,
  fallbackError: string,
): RuntimeOpenClawExecResultPayload {
  const payload = result.payload as RuntimeOpenClawExecResultPayload | undefined;
  if (result.type !== RUNTIME_OPENCLAW_EXEC_RESULT || !result.found || !payload?.ok) {
    throw new Error(payload?.error ?? fallbackError);
  }
  return payload;
}
