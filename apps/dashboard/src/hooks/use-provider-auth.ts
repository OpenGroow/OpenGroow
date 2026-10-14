"use client";

import { useEffect, useRef, useState } from "react";
import type { AuthJobState } from "@/src/components/instance-workspace.types";
import {
  isMissingAuthSessionError,
  isRestartRecoveredAuthError,
} from "@/src/components/instance-workspace.utils";
import {
  AUTH_RESTART_RECOVERY_MESSAGE,
  deriveProviderAuthUiState,
  isAuthRedirectSettled,
  isAuthStatusActive,
  type ProviderAuthUiState,
} from "@/src/hooks/provider-auth-ui-state";

export {
  AUTH_REDIRECT_URL_PREFIX,
  AUTH_RESTART_RECOVERY_MESSAGE,
} from "@/src/hooks/provider-auth-ui-state";

// The single source of truth for the Provider Auth lifecycle
// (start -> waiting_input -> success/failed, cancel, resume-after-restart).
// Both providers-page-content.tsx and burst-instance-panel.tsx consume this
// hook instead of duplicating auth state + manual polling — see issue #392.
//
// This intentionally owns only the ephemeral Auth *session* (this job). It
// does not own Provider persistence (activating/removing a stored Provider,
// switching auth.order, editing a linked subscription's model) — those
// mutate the permanent Provider list and stay in providers-page-content.tsx,
// per the issue's "ne pas mélanger persistance d'un Provider et état
// éphémère d'une session Auth".

type AuthActionResult = {
  job?: {
    id?: string;
    status?: string;
    logs?: string[];
    error?: string;
    awaitingResume?: boolean;
  };
  error?: string;
};

// Injected rather than resolved internally via useAction(api.auth_node.*) so
// the hook can be unit tested without a Convex provider.
export type ProviderAuthActions = {
  startAuth: (args: { instanceId: string; provider: string }) => Promise<AuthActionResult>;
  getAuthJob: (args: { jobId: string; instanceId?: string }) => Promise<AuthActionResult>;
  sendAuthInput: (args: {
    jobId: string;
    instanceId?: string;
    input?: string;
    enter?: boolean;
  }) => Promise<AuthActionResult>;
  cancelAuth: (args: { jobId: string; instanceId?: string }) => Promise<AuthActionResult>;
};

export type UseProviderAuthResult = ProviderAuthUiState & {
  job: AuthJobState;
  authInput: string;
  setAuthInput: (value: string) => void;
  authCancelling: boolean;
  authSubmittingRedirect: boolean;
  startAuth: (provider: string) => Promise<void>;
  sendAuthInput: (enter?: boolean) => Promise<void>;
  cancelAuth: () => Promise<void>;
  resetAuthFlow: (nextError?: string) => void;
};

export function useProviderAuth(
  runtimeInstanceId: string | undefined,
  actions: ProviderAuthActions,
): UseProviderAuthResult {
  const [job, setJob] = useState<AuthJobState>({});
  const [authInput, setAuthInput] = useState("");
  const [authPolling, setAuthPolling] = useState(false);
  const [authCancelling, setAuthCancelling] = useState(false);
  const [authSubmittingRedirect, setAuthSubmittingRedirect] = useState(false);

  // Callers build `actions` as a fresh object literal each render (see
  // burst-instance-panel.tsx), so the polling effect below reads through
  // this ref instead of depending on `actions` directly — that keeps its
  // deps honest without tearing down and restarting the interval every
  // render.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const uiState = deriveProviderAuthUiState(job, authInput, authSubmittingRedirect);

  // Marks the current job failed without losing what is already known about
  // it (id, logs) — the shape every error branch below needs.
  function failJob(error: string | undefined): void {
    setJob((prev) => ({ ...prev, status: "failed", error }));
  }

  function messageOf(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
  }

  // Folds a gateway response onto the known job, keeping the previous value
  // for every field the response omits.
  function mergeJob(data: AuthActionResult): void {
    setJob((prev) => ({
      ...prev,
      id: data.job?.id ?? prev.id,
      status: data.job?.status ?? prev.status,
      logs: data.job?.logs ?? prev.logs,
      error: data.job?.error,
      awaitingResume: data.job?.awaitingResume ?? prev.awaitingResume,
    }));
  }

  function resetAuthFlow(nextError?: string): void {
    setAuthInput("");
    setAuthPolling(false);
    setAuthCancelling(false);
    setAuthSubmittingRedirect(false);
    setJob(
      nextError
        ? {
            status: "failed",
            error: nextError,
            awaitingResume: isRestartRecoveredAuthError(nextError),
          }
        : {},
    );
  }

  async function startAuth(provider: string): Promise<void> {
    if (!runtimeInstanceId) {
      setJob({
        status: "failed",
        error: "Project not operational yet. Retry once the runtime is available.",
      });
      return;
    }

    setAuthInput("");
    setAuthSubmittingRedirect(false);
    setJob({ status: "queued", logs: [], error: undefined });

    try {
      const data = await actions.startAuth({ instanceId: runtimeInstanceId, provider });

      if (data.error) {
        setJob({ status: "failed", error: data.error });
        return;
      }

      if (data.job?.id) {
        setJob({
          id: data.job.id,
          status: data.job.status,
          logs: [],
          awaitingResume: data.job.awaitingResume,
        });
        setAuthPolling(true);
      }
    } catch (error: unknown) {
      setJob({ status: "failed", error: messageOf(error, "Auth failed") });
    }
  }

  useEffect(() => {
    if (!authPolling || !job.id) {
      return;
    }

    let cancelled = false;
    const poll = () => {
      void (async () => {
        try {
          const data = await actionsRef.current.getAuthJob({ jobId: job.id!, instanceId: runtimeInstanceId });

          if (cancelled) {
            return;
          }

          if (data.error) {
            if (isMissingAuthSessionError(data.error)) {
              resetAuthFlow(AUTH_RESTART_RECOVERY_MESSAGE);
              return;
            }
            failJob(data.error);
            setAuthPolling(false);
            return;
          }

          const nextStatus = data.job?.status;
          setJob((prev) => ({
            ...prev,
            status: nextStatus,
            logs: data.job?.logs ?? prev.logs,
            error: data.job?.error,
            awaitingResume: data.job?.awaitingResume,
          }));

          if (!isAuthStatusActive(nextStatus)) {
            setAuthPolling(false);
          }
        } catch (error: unknown) {
          if (error instanceof Error && isMissingAuthSessionError(error.message)) {
            resetAuthFlow(AUTH_RESTART_RECOVERY_MESSAGE);
            return;
          }
          failJob(messageOf(error, "Auth failed"));
          setAuthPolling(false);
        }
      })();
    };

    poll();
    const interval = window.setInterval(poll, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [job.id, authPolling, runtimeInstanceId]);

  useEffect(() => {
    if (!authSubmittingRedirect) {
      return;
    }

    if (isAuthRedirectSettled(job.status)) {
      setAuthSubmittingRedirect(false);
    }
  }, [job.status, authSubmittingRedirect]);

  async function sendAuthInput(enter = false): Promise<void> {
    if (!job.id) {
      return;
    }

    const authInputValue = authInput.trim();
    if (!enter && !authInputValue) {
      return;
    }

    if (!enter && uiState.authInputValidationError) {
      return;
    }

    try {
      if (!enter) {
        setAuthSubmittingRedirect(true);
      }
      const data = await actions.sendAuthInput({
        jobId: job.id,
        instanceId: runtimeInstanceId,
        input: enter ? undefined : authInputValue,
        enter: enter || undefined,
      });

      if (data.error) {
        if (isRestartRecoveredAuthError(data.error)) {
          setJob((prev) => ({
            ...prev,
            status: "failed",
            error: AUTH_RESTART_RECOVERY_MESSAGE,
            awaitingResume: true,
          }));
          setAuthPolling(false);
          setAuthSubmittingRedirect(false);
          return;
        }
        if (isMissingAuthSessionError(data.error)) {
          resetAuthFlow(AUTH_RESTART_RECOVERY_MESSAGE);
          return;
        }
        failJob(data.error);
        setAuthSubmittingRedirect(false);
        return;
      }

      const jobId = data.job?.id ?? job.id;
      mergeJob(data);
      setAuthPolling(true);
      void actions.getAuthJob({ jobId, instanceId: runtimeInstanceId }).then((next) => {
        if (!next.error) {
          mergeJob(next);
        }
      });
      if (!enter) {
        setAuthInput("");
      }
    } catch (error: unknown) {
      setAuthSubmittingRedirect(false);
      if (
        error instanceof Error &&
        (isMissingAuthSessionError(error.message) || isRestartRecoveredAuthError(error.message))
      ) {
        resetAuthFlow(AUTH_RESTART_RECOVERY_MESSAGE);
        return;
      }
      failJob(messageOf(error, "Failed to send auth input"));
    }
  }

  async function cancelAuth(): Promise<void> {
    if (!job.id) {
      resetAuthFlow();
      return;
    }

    setAuthCancelling(true);
    try {
      const data = await actions.cancelAuth({ jobId: job.id, instanceId: runtimeInstanceId });

      if (data.error) {
        if (isMissingAuthSessionError(data.error)) {
          resetAuthFlow(AUTH_RESTART_RECOVERY_MESSAGE);
          return;
        }
        failJob(data.error);
        return;
      }

      resetAuthFlow();
    } catch (error: unknown) {
      if (error instanceof Error && isMissingAuthSessionError(error.message)) {
        resetAuthFlow(AUTH_RESTART_RECOVERY_MESSAGE);
        return;
      }
      failJob(messageOf(error, "Failed to cancel auth flow"));
    } finally {
      setAuthCancelling(false);
    }
  }

  return {
    ...uiState,
    job,
    authInput,
    setAuthInput,
    authCancelling,
    authSubmittingRedirect,
    startAuth,
    sendAuthInput,
    cancelAuth,
    resetAuthFlow,
  };
}
