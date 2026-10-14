import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const {
  resolveSpeechToTextConfigRequest,
  handleSpeechToTextConfigRequest,
} = require("../docker/control-socket-speech-to-text.js") as {
  resolveSpeechToTextConfigRequest: (input: {
    provider?: string;
    enabled?: boolean;
    apiKey?: string;
    existingApiKey?: string;
  }) =>
    | {
        ok: true;
        provider: string;
        enabled: boolean;
        apiKeyToPersist: string | null;
      }
    | {
        ok: false;
        error: string;
      };
  handleSpeechToTextConfigRequest: (
    deps: {
      runCommandCapture: (
        cmd: string,
        args: string[],
        timeout: number,
      ) => Promise<{ stdout: string }>;
      readOpenClawConfigValue: (path: string) => Promise<unknown>;
      log: (message: string) => void;
      configTimeoutMs: number;
    },
    body: { provider?: string; enabled?: boolean; apiKey?: string },
  ) => Promise<{ status: number; body: unknown }>;
};

describe("control-socket speech-to-text config", () => {
  it("accepts a Groq key and enables speech-to-text", () => {
    expect(
      resolveSpeechToTextConfigRequest({
        provider: "groq",
        enabled: true,
        apiKey: "gsk_123",
        existingApiKey: "",
      }),
    ).toEqual({
      ok: true,
      provider: "groq",
      enabled: true,
      apiKeyToPersist: "gsk_123",
    });
  });

  it("keeps the existing key when disabling without a new key", () => {
    expect(
      resolveSpeechToTextConfigRequest({
        provider: "groq",
        enabled: false,
        apiKey: "",
        existingApiKey: "gsk_existing",
      }),
    ).toEqual({
      ok: true,
      provider: "groq",
      enabled: false,
      apiKeyToPersist: null,
    });
  });

  it("rejects enabling speech-to-text without any Groq key", () => {
    expect(
      resolveSpeechToTextConfigRequest({
        provider: "groq",
        enabled: true,
        apiKey: "",
        existingApiKey: "",
      }),
    ).toEqual({
      ok: false,
      error: "GROQ_API_KEY is required before enabling speech-to-text",
    });
  });

  it("rejects unsupported providers", () => {
    expect(
      resolveSpeechToTextConfigRequest({
        provider: "openai",
        enabled: true,
        apiKey: "sk-test",
        existingApiKey: "",
      }),
    ).toEqual({
      ok: false,
      error: "provider must be groq",
    });
  });

  it("propagates errors thrown by runCommandCapture during apply", async () => {
    const failure = new Error("openclaw config set failed");
    const runCommandCapture = vi
      .fn<(cmd: string, args: string[], timeout: number) => Promise<{ stdout: string }>>()
      .mockRejectedValue(failure);
    const readOpenClawConfigValue = vi
      .fn<(path: string) => Promise<unknown>>()
      .mockResolvedValue("gsk_existing");

    await expect(
      handleSpeechToTextConfigRequest(
        {
          runCommandCapture,
          readOpenClawConfigValue,
          log: () => {},
          configTimeoutMs: 1000,
        },
        { provider: "groq", enabled: true, apiKey: "" },
      ),
    ).rejects.toBe(failure);

    expect(runCommandCapture).toHaveBeenCalledTimes(1);
  });

  it("returns 400 without invoking runCommandCapture when validation fails", async () => {
    const runCommandCapture = vi.fn();
    const readOpenClawConfigValue = vi
      .fn<(path: string) => Promise<unknown>>()
      .mockResolvedValue("");

    const result = await handleSpeechToTextConfigRequest(
      {
        runCommandCapture: runCommandCapture as unknown as (
          cmd: string,
          args: string[],
          timeout: number,
        ) => Promise<{ stdout: string }>,
        readOpenClawConfigValue,
        log: () => {},
        configTimeoutMs: 1000,
      },
      { provider: "groq", enabled: true, apiKey: "" },
    );

    expect(result).toEqual({
      status: 400,
      body: {
        ok: false,
        error: "GROQ_API_KEY is required before enabling speech-to-text",
      },
    });
    expect(runCommandCapture).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleOpenClawExec's `output` computation — logic mirrored for unit testing
// (the real file is a self-executing script with no exports).
//
// Regression (self-host issue, 2026-07-07): this used to always merge
// `[stdout, stderr].join("\n")`. `openclaw agents list --json` writes the
// JSON array to stdout and ANSI-colored state-migration warnings to stderr
// — merging spliced that warning text right after valid JSON, breaking
// every JSON.parse caller downstream. On success, `output` must be stdout
// alone; the merge is only useful as a diagnostic when the command failed
// and stdout may be empty or unhelpful.
// ---------------------------------------------------------------------------

function computeExecOutput(result: { stdout: string; stderr: string; exitCode: number | null }): string {
  const mergedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  return result.exitCode === 0 ? result.stdout.trim() || mergedOutput : mergedOutput;
}

describe("handleOpenClawExec output computation", () => {
  it("returns clean stdout on success, ignoring stderr noise with its own brackets", () => {
    const stdout = JSON.stringify([{ id: "main", workspace: "/ws" }], null, 2);
    const stderr = "\x1b[32m[state-migrations]\x1b[39m Legacy state migration warnings:";
    const output = computeExecOutput({ stdout, stderr, exitCode: 0 });
    expect(output).toBe(stdout);
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("falls back to merged output on success if stdout is empty", () => {
    const output = computeExecOutput({ stdout: "  ", stderr: "some diagnostic", exitCode: 0 });
    expect(output).toBe("some diagnostic");
  });

  it("merges stdout and stderr for diagnostics when the command fails", () => {
    const output = computeExecOutput({
      stdout: "partial output",
      stderr: "error: something broke",
      exitCode: 1,
    });
    expect(output).toBe("partial output\nerror: something broke");
  });
});

// ---------------------------------------------------------------------------
// driveChildToCompletion's completion-signal recovery. The real function is
// imported from ../docker/control-socket-run-command.js (extracted out of the
// self-executing control-socket-server script precisely so it can be tested
// without a copy); we drive it with a FakeChild.
//
// Root cause (openclaw upstream, observed live 2026-07-09): the `openclaw
// agent --json --timeout N` process prints its own "[agent] run <id> ended
// with stopReason=<reason>" line once its agent loop finishes, but the OS
// process can then never emit Node's `close` event — some internal handle
// (most likely a provider/MCP keep-alive connection openclaw itself opened)
// keeps stdout/stderr open indefinitely. Before this fix, the only recovery
// was the outer `timeoutMs` (3_600_000ms for agent execs) — so a Run whose
// Agent had already finished and written a valid RunResult would sit as an
// orphaned process for up to an hour, while Convex's own (much shorter)
// watchdog gave up on it long before that.
// ---------------------------------------------------------------------------

import { EventEmitter } from "node:events";

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed: string[] = [];
  kill(signal: string) {
    this.killed.push(signal);
  }
}

// The real implementation under test — imported, not copied, so the grace /
// completion / timeout state machine can never drift from what ships. The
// server keeps only the trivial `spawn` wiring around driveChildToCompletion.
const { driveChildToCompletion, AGENT_RUN_ENDED_GRACE_MS } = require("../docker/control-socket-run-command.js") as {
  driveChildToCompletion: (
    child: FakeChild,
    timeoutMs: number,
    options?: { timeoutLabel?: string },
  ) => Promise<{ stdout: string; stderr: string; exitCode: number | null; signal: string | null }>;
  AGENT_RUN_ENDED_GRACE_MS: number;
};

describe("driveChildToCompletion completion-signal recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves normally via close when the process exits cleanly (unaffected by the new pattern check)", async () => {
    const child = new FakeChild();
    const promise = driveChildToCompletion(child, 3_600_000);

    child.stdout.emit("data", Buffer.from("some ordinary output\n"));
    child.emit("close", 0, null);

    const result = await promise;
    expect(result).toEqual({ stdout: "some ordinary output", stderr: "", exitCode: 0, signal: null });
    expect(child.killed).toEqual([]);
  });

  it("settles from accumulated output and kills the process when stopReason is seen but close never fires", async () => {
    const child = new FakeChild();
    const promise = driveChildToCompletion(child, 3_600_000);

    child.stdout.emit(
      "data",
      Buffer.from("Session complete.\n2026-07-09T22:49:16.626+00:00 [agent] run abc-123 ended with stopReason=stop\n"),
    );
    // No `close` event ever arrives — simulates the observed hang.
    await vi.advanceTimersByTimeAsync(AGENT_RUN_ENDED_GRACE_MS);

    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ended with stopReason=stop");
    expect(child.killed).toEqual(["SIGKILL"]);
  });

  it("reports a non-zero exit code when the completion line is an error and the process then hangs", async () => {
    const child = new FakeChild();
    const promise = driveChildToCompletion(child, 3_600_000);

    child.stdout.emit(
      "data",
      Buffer.from("[agent] run abc-123 ended with stopReason=error\n"),
    );
    // Process hangs after logging the error completion — grace path settles it.
    await vi.advanceTimersByTimeAsync(AGENT_RUN_ENDED_GRACE_MS);

    const result = await promise;
    // A run that ended in error must not be coerced to success (exit 0),
    // otherwise handleOpenClawExec masks the failure as a successful exec.
    expect(result.exitCode).not.toBe(0);
    expect(child.killed).toEqual(["SIGKILL"]);
  });

  it("prefers the normal close path when the process exits on its own within the grace window", async () => {
    const child = new FakeChild();
    const promise = driveChildToCompletion(child, 3_600_000);

    child.stdout.emit("data", Buffer.from("[agent] run abc-123 ended with stopReason=stop\n"));
    await vi.advanceTimersByTimeAsync(1_000);
    child.emit("close", 0, null);
    await vi.advanceTimersByTimeAsync(AGENT_RUN_ENDED_GRACE_MS);

    const result = await promise;
    // Resolved via the real close event, not the grace-timer fallback — no SIGKILL needed.
    expect(child.killed).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it("still enforces the outer timeout when neither the pattern nor close ever occurs", async () => {
    const child = new FakeChild();
    const promise = driveChildToCompletion(child, 10_000);
    const assertion = expect(promise).rejects.toThrow(/timed out after 10000ms/);

    child.stdout.emit("data", Buffer.from("still working...\n"));
    await vi.advanceTimersByTimeAsync(10_000);

    await assertion;
    expect(child.killed).toEqual(["SIGTERM"]);
  });

  it("does not falsely match plain agent-related log lines without the exact completion phrase", async () => {
    const child = new FakeChild();
    const promise = driveChildToCompletion(child, 3_600_000);

    child.stdout.emit("data", Buffer.from("[agent] run abc-123 is still processing tool calls\n"));
    await vi.advanceTimersByTimeAsync(AGENT_RUN_ENDED_GRACE_MS);
    child.emit("close", 0, null);

    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(child.killed).toEqual([]);
  });
});
