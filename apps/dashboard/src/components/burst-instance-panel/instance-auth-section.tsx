"use client";

import { useProviderAuth, type ProviderAuthActions } from "@/src/hooks/use-provider-auth";
import { preClass } from "./styles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// One Provider Auth session per instance row. burst-instance-panel renders a
// variable-length list of instances, and hooks cannot be called a variable
// number of times inside one component's render — so each row mounts its own
// instance of this subcomponent, which calls useProviderAuth exactly once.
// This is what replaced this file's own `authJobs` dict + manual polling
// effect (see issue #392): the shared hook now owns the same lifecycle
// providers-page-content.tsx uses.
export function InstanceAuthSection({
  instance,
  actions,
}: {
  instance: { openclawId?: string; openclawServerId?: number; ipv4?: string };
  actions: ProviderAuthActions;
}) {
  const {
    job,
    authInput,
    setAuthInput,
    authCancelling,
    authHasStarted,
    authCanAcceptRedirectInput,
    authInputValidationError,
    authSucceeded,
    authBrowserUrl,
    authCanSubmit,
    startAuth,
    sendAuthInput,
    cancelAuth,
  } = useProviderAuth(instance.openclawId, actions);

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Button variant="outline" size="sm"  type="button" onClick={() => void startAuth("openai")}>
          Start OAuth (openai)
        </Button>
      </div>
      {!authHasStarted && job.error ? (
        // A start that never produced a job id (no runtime yet, gateway
        // refused) has no job to render below, so surface its error here —
        // otherwise the click looks like it did nothing.
        <div style={{ color: "var(--status-error)", marginTop: 6, fontSize: 12 }}>{job.error}</div>
      ) : null}
      {authHasStarted ? (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            Auth job: {job.id} {job.status ? `(${job.status})` : ""}
          </div>
          {authSucceeded ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--status-success)" }}>
              OpenAI auth linked on this gateway.
            </div>
          ) : null}
          {authCanAcceptRedirectInput ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--status-warning)" }}>
              Waiting for OAuth redirect input…
            </div>
          ) : null}
          {job.error ? (
            <div style={{ color: "var(--status-error)", marginTop: 6, fontSize: 12 }}>{job.error}</div>
          ) : null}
          {authBrowserUrl ? (
            <div style={{ marginTop: 6 }}>
              <strong>Open URL:</strong> <code>{authBrowserUrl}</code>
            </div>
          ) : null}
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Input
              className="w-auto"
              style={{ minWidth: 320 }}
              placeholder="Paste redirect URL"
              value={authInput}
              onChange={(event) => setAuthInput(event.target.value)}
              disabled={!authCanAcceptRedirectInput}
            />
            <Button variant="outline" size="sm"  type="button" disabled={!authCanSubmit} onClick={() => void sendAuthInput(false)}>
              Submit OAuth Redirect
            </Button>
            <Button variant="outline" size="sm"  type="button" disabled={authCancelling} onClick={() => void cancelAuth()}>
              {authCancelling ? "Cancelling…" : "Cancel"}
            </Button>
          </div>
          {authInputValidationError ? (
            <div style={{ color: "var(--status-error)", marginTop: 6, fontSize: 12 }}>{authInputValidationError}</div>
          ) : null}
          {job.logs && job.logs.length ? <pre className={preClass}>{job.logs.join("\n")}</pre> : null}
        </div>
      ) : null}
    </>
  );
}
