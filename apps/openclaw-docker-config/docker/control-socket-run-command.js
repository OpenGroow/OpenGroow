"use strict";

// Completion-signal handling for long-running `openclaw` child processes.
//
// This module holds the part of command execution that carries real logic and
// therefore needs unit tests — the timeout / completion-grace / close state
// machine — separated from the trivial `spawn` wiring in control-socket-server.
// The server spawns the child and hands it to driveChildToCompletion; the test
// hands a fake child to the *same* function, so there is no duplicated copy to
// drift out of sync.

// Matches openclaw's own "[agent] run <id> ended with stopReason=<reason>"
// log line, printed to stdout once its agent loop finishes for any reason
// (stop, error, max_turns, ...). Upstream openclaw issue: after printing
// this line the process can fail to exit — some internal handle (a
// provider/MCP keep-alive connection, most likely) keeps the Node event
// loop alive indefinitely, so `close` never fires even though the actual
// work is done. See AGENT_RUN_ENDED_GRACE_MS below for how we recover.
const AGENT_RUN_ENDED_PATTERN = /\[agent] run \S+ ended with stopReason=(\S+)/;

// A clean agent run ends with stopReason=stop; any other reason (error,
// max_turns, ...) means the loop stopped without completing its work. When
// the process then hangs and we settle via the grace path, surface that as a
// non-zero exit instead of masking the failure as success — else
// handleOpenClawExec reports a successful exec and reconciliation follows the
// wrong path.
function agentRunEndedExitCode(stopReason) {
  return stopReason === "stop" ? 0 : 1;
}

// How long to wait, after seeing the completion line, for the process to
// exit on its own before we stop trusting `close` and settle from the
// output accumulated so far. Short enough to not meaningfully delay a
// response once the real work is done; long enough that a process closing
// normally a moment later still takes the ordinary `close` path
// (avoiding a redundant SIGKILL on the common case).
const AGENT_RUN_ENDED_GRACE_MS = 5_000;

// Drive an already-spawned child process to completion, resolving with its
// accumulated stdout/stderr and an exit code. Resolution takes whichever of
// three paths fires first: the child's own `close`, the completion-line grace
// timer (when openclaw hangs after logging it), or the outer timeout (reject).
function driveChildToCompletion(child, timeoutMs, options = {}) {
  const timeoutLabel = options.timeoutLabel ?? "command";
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let finished = false;
    let completionGraceTimer = null;

    const clearGraceTimer = () => {
      if (completionGraceTimer) {
        clearTimeout(completionGraceTimer);
        completionGraceTimer = null;
      }
    };

    const timer = setTimeout(() => {
      finished = true;
      clearGraceTimer();
      child.kill("SIGTERM");
      reject(new Error(`${timeoutLabel} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const match =
        !finished && !completionGraceTimer
          ? stdout.match(AGENT_RUN_ENDED_PATTERN)
          : null;
      if (match) {
        const exitCode = agentRunEndedExitCode(match[1]);
        completionGraceTimer = setTimeout(() => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          child.kill("SIGKILL");
          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode,
            signal: null,
          });
        }, AGENT_RUN_ENDED_GRACE_MS);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (finished) return;
      finished = true;
      clearGraceTimer();
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (finished) {
        return;
      }
      finished = true;
      clearGraceTimer();
      clearTimeout(timer);
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: typeof code === "number" ? code : null,
        signal: signal ?? null,
      });
    });
  });
}

module.exports = {
  AGENT_RUN_ENDED_PATTERN,
  AGENT_RUN_ENDED_GRACE_MS,
  agentRunEndedExitCode,
  driveChildToCompletion,
};
