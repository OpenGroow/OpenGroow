import { decideBoundedRetry, isTerminalDecision } from "@opengroow/reliability";
import { isPairingRequiredCloseReason } from "./ws-utils.js";

export type HelperPhase =
  | "connecting"
  | "waiting_for_approval"
  | "retrying"
  | "connected"
  | "timed_out"
  | "failed";

export type AttemptOutcome =
  | {
      kind: "upstream_close";
      stable: boolean;
      localClientConnected: boolean;
      code: number;
      reason: string;
    }
  | {
      kind: "upstream_error";
      stable: boolean;
      localClientConnected: boolean;
      error: string;
    }
  | {
      kind: "child_exit";
      stable: boolean;
      localClientConnected: boolean;
      exitCode: number;
      signal?: NodeJS.Signals;
    }
  | {
      kind: "child_error";
      stable: boolean;
      localClientConnected: boolean;
      error: string;
    }
  | {
      kind: "stopped";
      stable: boolean;
      localClientConnected: boolean;
      signal?: NodeJS.Signals;
    };

type SupervisorAction =
  | {
      type: "retry";
      nextPhase: "waiting_for_approval" | "retrying";
      pairingWaitDeadlineAt: number;
      sleepMs: number;
      message: string;
    }
  | {
      type: "timeout";
      nextPhase: "timed_out";
      message: string;
    }
  | {
      type: "fail";
      nextPhase: "failed";
      message: string;
    }
  | {
      type: "finish";
      nextPhase: "connected";
      exitCode: number;
      message?: string;
    };

export function decideSupervisorAction({
  outcome,
  now,
  pairingWaitDeadlineAt,
  pairingWaitMs,
  pairingRetryMs,
}: {
  outcome: AttemptOutcome;
  now: number;
  pairingWaitDeadlineAt: number | null;
  pairingWaitMs: number;
  pairingRetryMs: number;
}): SupervisorAction {
  if (outcome.stable) {
    return finishFromStableOutcome(outcome);
  }

  if (pairingWaitDeadlineAt === null && isPairingRequiredOutcome(outcome)) {
    const deadline = now + pairingWaitMs;
    const waitMin = Math.ceil(pairingWaitMs / 60_000);
    return {
      type: "retry",
      nextPhase: "waiting_for_approval",
      pairingWaitDeadlineAt: deadline,
      sleepMs: Math.min(pairingRetryMs, pairingWaitMs),
      message: `Relay not ready yet — waiting for openclaw:connect:run to establish a session. Will retry for up to ${waitMin}min. (If this is a new device, approve it in Dashboard > Devices.)`,
    };
  }

  if (
    pairingWaitDeadlineAt !== null &&
    isRetryableWhileWaitingForApproval(outcome)
  ) {
    const remainingMs = pairingWaitDeadlineAt - now;
    if (remainingMs <= 0) {
      return {
        type: "timeout",
        nextPhase: "timed_out",
        message: buildPairingTimeoutMessage(pairingWaitMs),
      };
    }
    const retrySec = Math.ceil(Math.min(pairingRetryMs, remainingMs) / 1000);
    const remainingSec = Math.ceil(remainingMs / 1000);
    return {
      type: "retry",
      nextPhase: "retrying",
      pairingWaitDeadlineAt,
      sleepMs: Math.min(pairingRetryMs, remainingMs),
      message: `Still waiting for openclaw:connect:run to connect. Retrying in ${retrySec}s (${remainingSec}s before timeout)...`,
    };
  }

  return {
    type: "fail",
    nextPhase: "failed",
    message: buildFatalOutcomeMessage(outcome),
  };
}

export function isInvalidDeviceSignatureOutcome(
  outcome: AttemptOutcome,
): boolean {
  return (
    outcome.kind === "upstream_close" &&
    outcome.code === 1008 &&
    /device signature (invalid|expired)/i.test(outcome.reason)
  );
}

// A gateway that rejects the device signature is telling us the timestamp the
// client signed with fell outside the gateway's tolerance window — see
// openclaw's DEVICE_SIGNATURE_SKEW_MS check. Rotating to a fresh local
// identity does nothing to fix that: the new identity's signature is derived
// from the same (possibly still-skewed) local clock, so a persistent skew
// (e.g. Docker Desktop's VM clock lagging after the host wakes from sleep)
// makes every rotation fail the same way. Bound the retries so the helper
// fails loudly with an actionable message instead of silently burning
// through identities forever — each one left behind as an orphaned,
// approved-but-never-connected node the operator has to notice and clean up.
export const MAX_INVALID_DEVICE_SIGNATURE_ROTATIONS = 3;

export function hasExhaustedDeviceSignatureRotations(
  consecutiveRotations: number,
): boolean {
  // Bookkeeping (counter vs. bound) folds through the shared bounded-retry
  // primitive (ADR-033) — this call site's own predicate is "the gateway
  // rejected the device signature", and its own terminal meaning is "clock
  // skew, not rotation count, is the real problem" (diagnosed by the caller,
  // see node-run.ts and ADR-033's out-of-scope note).
  const decision = decideBoundedRetry(
    { attempts: consecutiveRotations - 1 },
    { maxAttempts: MAX_INVALID_DEVICE_SIGNATURE_ROTATIONS },
  );
  return isTerminalDecision(decision);
}

export function buildDeviceSignatureRotationExhaustedMessage(
  consecutiveRotations: number,
): string {
  return (
    `Gateway rejected the device signature ${consecutiveRotations} times in a row, even after rotating to a ` +
    `fresh local identity each time. Rotating the identity cannot fix this — the most likely cause is a clock ` +
    `skew between this machine and the gateway (common after a laptop wakes from sleep with Docker Desktop ` +
    `running: its VM clock can lag behind real time until it resyncs). Check that both clocks agree, then run ` +
    `openclaw-connect:node-run again.`
  );
}

export function isConnectTicketExpiredOutcome(
  outcome: AttemptOutcome,
): boolean {
  if (outcome.kind === "upstream_close") {
    return outcome.code === 1008 && /connect ticket/i.test(outcome.reason);
  }
  if (outcome.kind === "upstream_error") {
    return /unexpected server response:\s*404/i.test(outcome.error);
  }
  return false;
}

function finishFromStableOutcome(outcome: AttemptOutcome): SupervisorAction {
  if (outcome.kind === "child_exit") {
    return {
      type: "finish",
      nextPhase: "connected",
      exitCode: outcome.exitCode,
      message:
        outcome.exitCode === 0
          ? undefined
          : `Remote helper exited with code ${outcome.exitCode}.`,
    };
  }

  if (outcome.kind === "stopped") {
    return { type: "finish", nextPhase: "connected", exitCode: 0 };
  }

  if (outcome.kind === "upstream_close" && outcome.code === 1000) {
    return {
      type: "finish",
      nextPhase: "connected",
      exitCode: 0,
      message: outcome.reason.trim()
        ? `Gateway relay closed normally: ${outcome.reason.trim()}`
        : undefined,
    };
  }

  return {
    type: "finish",
    nextPhase: "connected",
    exitCode: 1,
    message: buildFatalOutcomeMessage(outcome),
  };
}

function isPairingRequiredOutcome(outcome: AttemptOutcome): boolean {
  if (
    outcome.kind === "upstream_close" &&
    outcome.code === 1000 &&
    !outcome.stable
  ) {
    return true;
  }

  return (
    outcome.kind === "upstream_close" &&
    outcome.code === 1008 &&
    isPairingRequiredCloseReason(outcome.reason)
  );
}

function isRetryableWhileWaitingForApproval(outcome: AttemptOutcome): boolean {
  if (outcome.kind !== "upstream_close") {
    return false;
  }
  if (outcome.code === 1000 || outcome.code === 1006) {
    return true;
  }
  return outcome.code === 1008 && isPairingRequiredCloseReason(outcome.reason);
}

function buildPairingTimeoutMessage(pairingWaitMs: number): string {
  const waitMin = Math.ceil(pairingWaitMs / 60_000);
  return `Timed out after ${waitMin}min — openclaw:connect:run did not connect. Generate a new connect link and try again. (If this is a new device, approve it in Dashboard > Devices first.)`;
}

export function buildFatalOutcomeMessage(outcome: AttemptOutcome): string {
  if (outcome.kind === "upstream_close") {
    const reason = outcome.reason.trim();
    return reason
      ? `Gateway relay closed (${outcome.code}): ${reason}`
      : `Gateway relay closed (${outcome.code}).`;
  }
  if (outcome.kind === "upstream_error") {
    return `Upstream relay error: ${outcome.error}`;
  }
  if (outcome.kind === "child_error") {
    return `Failed to launch local OpenClaw node helper: ${outcome.error}`;
  }
  if (outcome.kind === "child_exit") {
    const signalSuffix = outcome.signal ? ` (signal ${outcome.signal})` : "";
    return `Local OpenClaw node helper exited with code ${outcome.exitCode}${signalSuffix}.`;
  }
  return "Local OpenClaw node helper stopped.";
}
