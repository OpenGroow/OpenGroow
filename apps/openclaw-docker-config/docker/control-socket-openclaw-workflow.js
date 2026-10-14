const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const { spawn } = require("node:child_process");
const { join, dirname } = require("node:path");
const { driveChildToCompletion } = require("./control-socket-run-command");
const {
  resolveOpenClawBinaryAndEnv: resolveOpenClawBinaryAndEnvShared,
} = require("./control-socket-openclaw");

/**
 * Extract the outputs file path from an `openclaw agent` command's argv.
 * The agent message always contains
 * `missions/<missionId>/outputs/<runId>.json` — returns the resolved
 * absolute path or `undefined` if the argv is not an agent command or
 * the message doesn't contain an outputs path.
 */
function extractOutputsPath(argv, cwd) {
  if (argv[0] !== "agent") return undefined;
  const msgIndex = argv.indexOf("--message");
  if (msgIndex < 0 || msgIndex + 1 >= argv.length) return undefined;
  const message = argv[msgIndex + 1];
  const match = /missions\/([^/]+)\/outputs\/([^/]+)\.json/.exec(message);
  if (!match) return undefined;
  return join(cwd, `missions/${match[1]}/outputs/${match[2]}.json`);
}

/**
 * When the openclaw-agent process finishes (or is killed) without writing
 * its RunResult file, the reconciliation layer's salvage reads find nothing
 * and the run is marked `file_missing`.
 *
 * Writing a synthetic failed RunResult to the outputs file gives the
 * salvage read something to find. Two call sites:
 *
 * 1. **Exec timed out** — the hard watchdog killed the process before it
 *    could finish. Called before re-throwing the timeout error.
 * 2. **Exec completed but no outputs file** — the agent exited cleanly
 *    (e.g. `sessionExpired` fired, `close_app` ran) but never wrote its
 *    RunResult (a known agent bug). Called after the exec returns.
 *
 * Best-effort: a write failure is logged but never masks the original error.
 */
async function writeFallbackResult(argv, summary, errorMessage, cwd, errorCode = "timeout") {
  const outputsPath = extractOutputsPath(argv, cwd);
  if (!outputsPath) return;
  const fallback = JSON.stringify({
    status: "failed",
    summary,
    error: { code: errorCode, message: errorMessage },
  });
  try {
    await fsPromises.mkdir(dirname(outputsPath), { recursive: true });
    // Only write if the agent hasn't already written a result.
    try {
      await fsPromises.access(outputsPath);
      return; // File exists — don't overwrite the agent's own result.
    } catch {
      // File doesn't exist — write the fallback.
    }
    await fsPromises.writeFile(outputsPath, fallback, "utf-8");
  } catch {
    // Best-effort: the reconciliation layer's salvage reads will still
    // surface the original error if this write fails.
  }
}

const DEFAULT_EXEC_TIMEOUT_MS = 30_000;
const DEFAULT_CHANNEL_LOGIN_TIMEOUT_MS = 180_000;
const DEFAULT_LOCAL_PREFIX = "/home/node/.local";
const ALLOWED_OPENCLAW_ROOT_COMMANDS = new Set([
  "agent",
  "agents",
  "browser",
  "channels",
  "config",
  "doctor",
  "gateway",
  "help",
  "logs",
  "nodes",
  "pairing",
  "status",
  "update",
]);
const ALLOWED_CLAWHUB_ROOT_COMMANDS = new Set(["install"]);

function createOpenClawWorkflow(options = {}) {
  const localPrefix = options.localPrefix ?? process.env.OPENCLAW_LOCAL_PREFIX ?? DEFAULT_LOCAL_PREFIX;
  const localClawHubBin = join(localPrefix, "bin", "clawhub");
  const execTimeoutMs = options.execTimeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
  const channelLoginTimeoutMs = options.channelLoginTimeoutMs ?? DEFAULT_CHANNEL_LOGIN_TIMEOUT_MS;
  const log = options.log ?? (() => {});
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const cwd = options.cwd ?? process.cwd();
  const scheduleGatewayContainerRestart =
    options.scheduleGatewayContainerRestart ??
    (() => setTimeout(() => process.kill(1, "SIGTERM"), 100));

  function isOpenClawCommand(command) {
    return command === "openclaw" || command.endsWith("/openclaw");
  }

  function envForCommand(command) {
    if (!isOpenClawCommand(command)) {
      return process.env;
    }
    return { ...process.env, OPENCLAW_GATEWAY_PORT: "18789" };
  }

  function resolveOpenClawBinaryAndEnv() {
    return resolveOpenClawBinaryAndEnvShared({ localPrefix });
  }

  function resolveClawHubBinaryAndEnv() {
    const env = { ...process.env };
    if (fs.existsSync(localClawHubBin)) {
      const localBinDir = dirname(localClawHubBin);
      env.PATH = env.PATH ? `${localBinDir}:${env.PATH}` : localBinDir;
      return { binary: localClawHubBin, env };
    }
    return { binary: "clawhub", env };
  }

  async function runCommandDetailedDefault(command, args, timeoutMs, runOptions = {}) {
    const child = spawn(command, args, {
      env: runOptions.env ?? envForCommand(command),
      stdio: ["ignore", "pipe", "pipe"],
    });
    return driveChildToCompletion(child, timeoutMs, {
      timeoutLabel: `${command} ${args[0] ?? ""}`,
    });
  }

  const runCommandDetailed =
    options.runCommandDetailed ?? runCommandDetailedDefault;

  async function runOpenClawCommand(argv, timeoutMs) {
    const { binary, env } = resolveOpenClawBinaryAndEnv();
    // Generic commands authenticate through the Gateway environment or the
    // persisted CLI device. `--token` is command-specific and is rejected by
    // commands such as `openclaw agent`; only the dedicated node/device
    // management callers add the shared Gateway token explicitly.
    return runCommandDetailed(binary, argv, timeoutMs, { env });
  }

  async function runClawHubCommand(argv, timeoutMs) {
    const { binary, env } = resolveClawHubBinaryAndEnv();
    return runCommandDetailed(binary, argv, timeoutMs, { env });
  }

  function buildOpenClawPackageSpec(argv) {
    let tag = "latest";
    for (let index = 1; index < argv.length; index += 1) {
      const current = argv[index];
      const next = argv[index + 1];
      if ((current === "--tag" || current === "--channel") && typeof next === "string" && next.trim()) {
        tag = next.trim();
        index += 1;
      }
    }
    return `openclaw@${tag}`;
  }

  async function runRootlessOpenClawUpdate(argv, timeoutMs) {
    const packageSpec = buildOpenClawPackageSpec(argv);
    await fsPromises.mkdir(localPrefix, { recursive: true });
    const { env } = resolveOpenClawBinaryAndEnv();
    const result = await runCommandDetailed(
      "npm",
      ["install", "-g", packageSpec, "--prefix", localPrefix],
      timeoutMs,
      { env },
    );
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    return {
      ...result,
      stdout: output || `Installed ${packageSpec} to ${localPrefix}.`,
      stderr: "",
    };
  }

  function tokenize(commandText) {
    const args = [];
    let current = "";
    let quote = null;
    let escaping = false;
    for (const char of commandText) {
      if (escaping) {
        current += char;
        escaping = false;
        continue;
      }
      if (char === "\\" && quote !== "'") {
        escaping = true;
        continue;
      }
      if (quote) {
        if (char === quote) quote = null;
        else current += char;
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
        continue;
      }
      if (/\s/.test(char)) {
        if (current) {
          args.push(current);
          current = "";
        }
        continue;
      }
      current += char;
    }
    if (quote) throw new Error("Unterminated quote in OpenClaw command");
    if (escaping) current += "\\";
    if (current) args.push(current);
    return args;
  }

  function normalize(commandText) {
    const parsed = tokenize(commandText);
    if (!parsed.length) throw new Error("OpenClaw command is required");
    if (parsed[0] === "clawhub") {
      const argv = parsed.slice(1);
      if (!argv.length) throw new Error("ClawHub command is required");
      if (!ALLOWED_CLAWHUB_ROOT_COMMANDS.has(argv[0])) {
        throw new Error(`Unsupported ClawHub command root: ${argv[0]}. Allowed: ${Array.from(ALLOWED_CLAWHUB_ROOT_COMMANDS).join(", ")}`);
      }
      return { binary: "clawhub", argv };
    }
    if (parsed[0] === "openclaw") parsed.shift();
    if (!parsed.length) throw new Error("OpenClaw command is required");
    if (parsed[0] === "--version" || parsed[0] === "-v") {
      return { binary: "openclaw", argv: parsed };
    }
    if (!ALLOWED_OPENCLAW_ROOT_COMMANDS.has(parsed[0])) {
      throw new Error(`Unsupported OpenClaw command root: ${parsed[0]}. Allowed: ${Array.from(ALLOWED_OPENCLAW_ROOT_COMMANDS).join(", ")}`);
    }
    return { binary: "openclaw", argv: parsed };
  }

  function extractAgentSessionId(argv) {
    if (argv[0] !== "agent") return undefined;
    const index = argv.indexOf("--session-id");
    return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined;
  }

  /**
   * Kill the `openclaw agent` process running the given OpenClaw session,
   * best-effort. Used twice: as the pre-exec safety net against a stale
   * duplicate process for the same session, and as the on-demand cancel
   * primitive behind the dashboard's Stop action (issue #482).
   *
   * Returns `pkill`'s exit code — 0 when it actually killed something, 1 when
   * nothing matched — or `null` when the attempt itself never completed
   * (spawn failure or timeout). Nothing here is an error: "no matching
   * process" is the normal, idempotent outcome for both callers.
   */
  async function killAgentSession(sessionId) {
    try {
      // `--` ends option parsing so pkill treats the pattern (which itself
      // starts with `--`) as the positional pattern argument instead of
      // trying to parse it as another pkill option — without it, pkill
      // silently fails to match the process and Stop never actually kills it.
      const result = await runCommandDetailed("pkill", ["-f", "--", `--session-id ${sessionId}`], 3000);
      return typeof result?.exitCode === "number" ? result.exitCode : null;
    } catch {
      // No matching process is the normal case.
      return null;
    }
  }

  async function execute(body = {}) {
    const commandText = typeof body.commandText === "string" ? body.commandText.trim() : "";
    const { binary, argv } = normalize(commandText);
    const requestedTimeoutMs = typeof body.timeoutMs === "number" && Number.isFinite(body.timeoutMs)
      ? Math.max(1000, Math.floor(body.timeoutMs))
      : execTimeoutMs;
    const timeoutMs = argv[0] === "channels" && argv[1] === "login"
      ? Math.max(requestedTimeoutMs, channelLoginTimeoutMs)
      : requestedTimeoutMs;
    log(`${binary} exec: ${argv.join(" ")}`);

    const agentSessionId = extractAgentSessionId(argv);
    if (agentSessionId && (await killAgentSession(agentSessionId)) !== null) {
      // Give the kernel a beat to reap the stale process before spawning its
      // replacement for the same session. Unchanged from the long-standing
      // behaviour: the settle delay is skipped only when the pkill attempt
      // itself never completed.
      await sleep(300);
    }

    if (argv[0] === "gateway" && argv[1] === "restart") {
      return {
        status: 200,
        // Deferred until the HTTP response has actually finished writing,
        // so the caller sees the ack before PID 1 receives SIGTERM.
        afterResponse: scheduleGatewayContainerRestart,
        body: {
          ok: true,
          data: {
            output: "Gateway container restart scheduled. Docker will restart the service because it is configured with restart=unless-stopped.",
            success: true,
            exitCode: 0,
            commandText,
          },
        },
      };
    }

    let result;
    try {
      result = binary === "clawhub"
        ? await runClawHubCommand(argv, timeoutMs)
        : argv[0] === "update" && argv[1] !== "status"
          ? await runRootlessOpenClawUpdate(argv, timeoutMs)
          : await runOpenClawCommand(argv, timeoutMs);
    } catch (err) {
      if (err instanceof Error && /timed out/i.test(err.message)) {
        await writeFallbackResult(
          argv,
          "Agent session timed out before writing its result file.",
          "The openclaw-agent process was killed by the hard watchdog timeout before it could write its RunResult.",
          cwd,
        );
      }
      throw err;
    }
    const mergedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    const output = result.exitCode === 0 ? result.stdout.trim() || mergedOutput : mergedOutput;

    // When the agent exits cleanly (exitCode 0, e.g. sessionExpired fired
    // and close_app ran) but never wrote its RunResult file, the
    // reconciliation layer would mark the run `file_missing`. Write a
    // fallback so the salvage read finds something. Only for agent
    // commands that carry an outputs path in their message.
    if (result.exitCode === 0) {
      const outputsPath = extractOutputsPath(argv, cwd);
      if (outputsPath) {
        try {
          await fsPromises.access(outputsPath);
        } catch {
          // File doesn't exist — agent exited without writing its result.
          await writeFallbackResult(
            argv,
            "Agent completed but did not write its result file.",
            "The openclaw-agent process exited successfully but never wrote its RunResult to the expected outputs file.",
            cwd,
            "file_missing",
          );
        }
      }
    }

    return {
      status: 200,
      body: {
        ok: true,
        data: {
          output: output || "(no output)",
          success: result.exitCode === 0,
          error: result.exitCode === 0
            ? undefined
            : output || `openclaw exited with code ${result.exitCode ?? "unknown"}${result.signal ? ` (${result.signal})` : ""}`,
          exitCode: result.exitCode,
          commandText,
        },
      },
    };
  }

  async function cancel(body = {}) {
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    if (!sessionId) {
      return { status: 400, body: { ok: false, error: "sessionId is required" } };
    }
    // Best-effort and idempotent by design (issue #482): a Stop that races the
    // process finishing on its own finds nothing to kill, and that is still a
    // successful cancel from the operator's point of view — hence `ok: true`
    // for pkill exit 0 (killed) or 1 (no matching process). Any other outcome
    // (a pkill syntax/fatal error, exit codes 2/3, or the spawn itself never
    // completing) means we don't actually know whether the agent process is
    // still alive, so report `ok: false` — cancelMission then throws instead
    // of marking the Run/Mission cancelled, keeping Stop retryable rather
    // than falsely confirming a kill that may not have happened.
    const exitCode = await killAgentSession(sessionId);
    if (exitCode !== 0 && exitCode !== 1) {
      return {
        status: 200,
        body: { ok: false, error: `Failed to stop the agent process (pkill exit code ${exitCode ?? "unknown"})` },
      };
    }
    return { status: 200, body: { ok: true, data: { cancelled: exitCode === 0 } } };
  }

  return { execute, cancel, normalize, tokenize };
}

module.exports = { createOpenClawWorkflow };
