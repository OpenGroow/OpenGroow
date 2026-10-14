import type { AuthJobState } from "@/src/components/instance-workspace.types";
import {
  extractAuthBrowserUrl,
  isRestartRecoveredAuthError,
} from "@/src/components/instance-workspace.utils";

// The pure derivation layer of the Provider Auth lifecycle: everything the two
// dashboard screens read off an auth job without touching React state. Split
// out of use-provider-auth.ts to keep both files under the ~300-line ceiling in
// docs/CODE_CONVENTIONS.md, and so the derivations can be exercised directly.

export const AUTH_REDIRECT_URL_PREFIX = "http://localhost:1455/";
export const AUTH_RESTART_RECOVERY_MESSAGE =
  "Gateway restarted during authorization. Start the flow again.";

// A job in one of these statuses is still moving, so polling must continue.
// Anything else — succeeded, failed, cancelled, unknown — is terminal.
const AUTH_ACTIVE_STATUSES = ["queued", "running", "waiting_input"];
// Statuses that mean the gateway has answered a submitted redirect, one way or
// another, so the "Verifying…" spinner can stop.
const AUTH_SETTLED_STATUSES = [
  "running",
  "waiting_input",
  "succeeded",
  "failed",
  "cancelled",
];

export function isAuthStatusActive(status: string | undefined): boolean {
  return AUTH_ACTIVE_STATUSES.includes(status ?? "");
}

export function isAuthRedirectSettled(status: string | undefined): boolean {
  return AUTH_SETTLED_STATUSES.includes(status ?? "");
}

export type ProviderAuthUiState = {
  authHasStarted: boolean;
  authIsStarting: boolean;
  authCanAcceptRedirectInput: boolean;
  authInputValidationError: string | undefined;
  authIsVerifyingRedirect: boolean;
  authSucceeded: boolean;
  authRestartRecovered: boolean;
  authBrowserUrl: string | undefined;
  authCanSubmit: boolean;
};

export function deriveProviderAuthUiState(
  job: AuthJobState,
  authInput: string,
  authSubmittingRedirect: boolean,
): ProviderAuthUiState {
  const authBrowserUrl = extractAuthBrowserUrl(job.logs ?? []);
  const authHasStarted = Boolean(job.id);
  const authIsStarting = job.status === "queued" || job.status === "running";
  const authCanAcceptRedirectInput = job.status === "waiting_input";
  const authInputValue = authInput.trim();
  const authInputValidationError =
    authCanAcceptRedirectInput &&
    authInputValue &&
    !authInputValue.startsWith(AUTH_REDIRECT_URL_PREFIX)
      ? `Redirect URL must start with ${AUTH_REDIRECT_URL_PREFIX}`
      : undefined;

  return {
    authHasStarted,
    authIsStarting,
    authCanAcceptRedirectInput,
    authInputValidationError,
    authIsVerifyingRedirect:
      authHasStarted &&
      Boolean(authBrowserUrl) &&
      (job.status === "running" || authSubmittingRedirect),
    authSucceeded: job.status === "succeeded",
    authRestartRecovered:
      job.awaitingResume === true || isRestartRecoveredAuthError(job.error),
    authBrowserUrl,
    authCanSubmit: Boolean(
      job.id &&
        authCanAcceptRedirectInput &&
        authInputValue &&
        !authInputValidationError &&
        !authSubmittingRedirect,
    ),
  };
}
