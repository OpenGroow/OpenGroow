import {
  RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
  RUNTIME_SKILLS_INSTALL_BATCH_RESULT,
  parseOpenClawAgents,
} from "@opengroow/protocol";
import { createEventMessage } from "./event-message.js";
import { readTimeoutMs } from "./command-inputs.js";
import type { CommandHandler, RuntimeDeps } from "./types.js";

/**
 * Compound handlers exist because the Runtime Worker starts every command
 * handler it receives without awaiting the previous one (see
 * CommandRouter.handleCommand): a batch of independent commands is delivered
 * as a batch, but its handlers run concurrently. Steps that must happen in
 * order — or that are simply not parallel-safe, like ClawHub installs — have
 * to be sequenced *inside* a single command instead.
 */

/**
 * Per-step budget when the caller does not pass one. Convex sizes its own
 * wait as `steps * timeoutMs + margin` from the same number, so a compound
 * command can never outlive the wait that is watching it.
 */
const DEFAULT_STEP_TIMEOUT_MS = 120_000;

type ExecOutcome = { ok: boolean; output: string; exitCode: number | null; error?: string };

async function runOpenClawCommand(
  deps: RuntimeDeps,
  commandText: string,
  timeoutMs: number,
): Promise<ExecOutcome> {
  try {
    deps.log(`openclaw exec: ${commandText}`);
    const result = await deps.gatewayClient.requestGatewayControl<{
      output: string;
      success?: boolean;
      exitCode?: number | null;
      error?: string;
    }>("/openclaw/exec", { commandText, timeoutMs });
    const ok = result.success !== false;
    return {
      ok,
      output: result.output || "",
      exitCode: typeof result.exitCode === "number" ? result.exitCode : null,
      error: ok ? undefined : result.error || "OpenClaw command failed",
    };
  } catch (error) {
    return {
      ok: false,
      output: "",
      exitCode: null,
      error: error instanceof Error ? error.message : "OpenClaw command failed",
    };
  }
}

function readCommandTexts(payload: unknown, field: string): string[] | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[field];
  if (!Array.isArray(value)) return null;
  const texts = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return texts.length === value.length ? texts : null;
}

function readString(payload: unknown, field: string): string {
  if (!payload || typeof payload !== "object") return "";
  const value = (payload as Record<string, unknown>)[field];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Install several ClawHub skills **one at a time**. ClawHub is not
 * parallel-safe (issue #447): concurrent installs can fail or corrupt each
 * other's skill directories. Every spec is attempted — one failure does not
 * abort the rest — so the caller gets a per-spec outcome to fold into its
 * skills mirror.
 */
export const handleSkillsInstallBatch: CommandHandler = async (command, deps) => {
  const specs = readCommandTexts(command.payload, "specs");
  const commandTexts = readCommandTexts(command.payload, "commandTexts");
  const timeoutMs = readTimeoutMs(command.payload, DEFAULT_STEP_TIMEOUT_MS);

  if (!specs || !commandTexts || specs.length === 0 || specs.length !== commandTexts.length) {
    return createEventMessage(RUNTIME_SKILLS_INSTALL_BATCH_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error: "specs and commandTexts are required and must be non-empty arrays of the same length",
      data: { results: [] },
    });
  }

  const results: Array<{ spec: string; ok: boolean; output: string; error?: string }> = [];
  for (let index = 0; index < specs.length; index++) {
    const outcome = await runOpenClawCommand(deps, commandTexts[index], timeoutMs);
    results.push({
      spec: specs[index],
      ok: outcome.ok,
      output: outcome.output,
      error: outcome.error,
    });
  }

  const failed = results.filter((result) => !result.ok);
  return createEventMessage(RUNTIME_SKILLS_INSTALL_BATCH_RESULT, command.id, {
    commandId: command.id,
    instanceId: deps.getRuntimeInstanceId(),
    ok: failed.length === 0,
    error: failed.length === 0 ? undefined : `Failed to install ${failed.length} skill(s)`,
    data: { results },
  });
};

/**
 * Run the whole `agents list` → `agents add` → `config set` sequence as one
 * command (issue #447). Two things depend on it being one command rather
 * than three: the router starts batched handlers concurrently, so a separate
 * `config set` could race `agents add` on the same config file; and two
 * concurrent activations doing their own list-then-add would both observe the
 * agent as absent and issue competing adds.
 */
export const handleAgentRegisterAndConfigure: CommandHandler = async (command, deps) => {
  const agentId = readString(command.payload, "agentId");
  const listCommandText = readString(command.payload, "listCommandText");
  const registerCommandText = readString(command.payload, "registerCommandText");
  const configureCommandText = readString(command.payload, "configureCommandText");
  const timeoutMs = readTimeoutMs(command.payload, DEFAULT_STEP_TIMEOUT_MS);

  const fail = (error: string, data: Record<string, unknown> = {}) =>
    createEventMessage(RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error,
      data: { agentId, alreadyRegistered: false, registered: false, configured: false, ...data },
    });

  if (!agentId || !listCommandText || !registerCommandText) {
    return fail("agentId, listCommandText and registerCommandText are required");
  }

  const list = await runOpenClawCommand(deps, listCommandText, timeoutMs);
  if (!list.ok) {
    return fail(list.error ?? "OpenClaw agents list failed");
  }
  let existing: { id: string; workspace?: string } | undefined;
  try {
    existing = parseOpenClawAgents(list.output).find((agent) => agent.id === agentId);
  } catch (error) {
    return fail(
      `OpenClaw agents list returned invalid JSON: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }

  // Already registered: the caller only wants to know where, so it can warn
  // on a workspace mismatch. Re-adding would fail and rewriting the config is
  // not this command's job.
  if (existing) {
    return createEventMessage(RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: true,
      data: {
        agentId,
        alreadyRegistered: true,
        registered: true,
        configured: false,
        workspace: existing.workspace,
      },
    });
  }

  const register = await runOpenClawCommand(deps, registerCommandText, timeoutMs);
  if (!register.ok) {
    return fail(register.error ?? "OpenClaw agents add failed", { output: register.output });
  }

  if (!configureCommandText) {
    return createEventMessage(RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: true,
      data: {
        agentId,
        alreadyRegistered: false,
        registered: true,
        configured: false,
        output: register.output,
      },
    });
  }

  const configure = await runOpenClawCommand(deps, configureCommandText, timeoutMs);
  return createEventMessage(RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT, command.id, {
    commandId: command.id,
    instanceId: deps.getRuntimeInstanceId(),
    // The agent is registered and usable either way; a failed deny-list write
    // is surfaced through `configureError` for the caller to report, and never
    // rolls back the registration.
    ok: true,
    data: {
      agentId,
      alreadyRegistered: false,
      registered: true,
      configured: configure.ok,
      configureError: configure.ok ? undefined : configure.error,
      output: register.output,
    },
  });
};
