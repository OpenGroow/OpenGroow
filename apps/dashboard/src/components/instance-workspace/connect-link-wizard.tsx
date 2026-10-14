"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import type { InstanceRecord } from "@/src/components/instance-workspace.types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useConnectWizard } from "./use-connect-wizard";
import { WizardStep, getWizardPhaseMessage } from "./wizard-step";

export function ConnectLinkWizard({
  instance,
  startFresh = false,
  onConnected,
}: {
  instance: InstanceRecord;
  startFresh?: boolean;
  onConnected?: () => void;
}) {
  const {
    approvalSubmitted,
    approvingDevice,
    connectTicket,
    deviceSaveStatus,
    handleApproveDevice,
    handleCreateConnectTicket,
    pendingNodeRequestCount,
    pendingNodeRequestId,
    sessionStatus,
    wizardError,
    wizardPhase,
  } = useConnectWizard(instance, startFresh);

  const phaseMessage = getWizardPhaseMessage({
    pendingNodeRequestCount,
    phase: wizardPhase,
    sessionStatus,
  });
  const phaseTone =
    wizardPhase === "failed" || wizardPhase === "expired"
      ? "text-[#8f3030]"
      : wizardPhase === "connected"
        ? "text-[#236949]"
        : "text-[var(--dashboard-ink-muted)]";

  const stepOneComplete = connectTicket.ticket !== undefined;
  const stepTwoComplete =
    wizardPhase === "approval_required" ||
    wizardPhase === "reconnecting" ||
    wizardPhase === "connected";
  const stepThreeComplete =
    wizardPhase === "reconnecting" || wizardPhase === "connected";

  useEffect(() => {
    if (
      wizardPhase !== "connected" ||
      !onConnected ||
      (deviceSaveStatus !== "saved" && deviceSaveStatus !== "failed")
    ) {
      return;
    }
    const timer = window.setTimeout(onConnected, 500);
    return () => window.clearTimeout(timer);
  }, [wizardPhase, deviceSaveStatus, onConnected]);

  return (
    <Card className="gap-5 rounded-[1.5rem] border-0 bg-white/92 py-6 shadow-[0_18px_48px_rgba(25,28,28,0.08)] ring-1 ring-[rgba(0,38,27,0.08)]">
      <CardHeader className="grid gap-2 px-6 pb-0">
        <CardTitle className="text-[1.35rem] leading-[1.1] tracking-[-0.04em] text-[var(--dashboard-ink)]">
          Connect Link
        </CardTitle>
        <CardDescription className="max-w-2xl text-base leading-7 text-[var(--dashboard-ink-muted)]">
          Generate a public link and guide the remote helper through connection,
          approval, and reconnect confirmation.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 px-6">
        <WizardStep
          complete={stepOneComplete}
          active={!stepOneComplete || wizardPhase === "failed" || wizardPhase === "expired"}
          index={1}
          title="Generate the connect link"
        >
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              className="h-11 rounded-xl bg-[var(--dashboard-primary)] px-5 text-[var(--dashboard-on-primary)] hover:bg-[var(--dashboard-primary-container)]"
              onClick={() => void handleCreateConnectTicket()}
            >
              {connectTicket.ticket ? "Generate new connect link" : "Create connect link"}
            </Button>
          </div>
          {connectTicket.status === "creating" ? (
            <p className="text-sm text-[var(--dashboard-ink-muted)]">
              Creating public connect ticket…
            </p>
          ) : null}
          {connectTicket.ticket ? (
            <p className="text-sm text-[#236949]">
              Connect ticket ready until{" "}
              {new Date(connectTicket.ticket.expiresAt).toLocaleString()}.
            </p>
          ) : null}
        </WizardStep>

        <WizardStep
          complete={stepTwoComplete}
          active={stepOneComplete && !stepTwoComplete}
          index={2}
          title="Launch the remote helper"
          description="Run the helper command on the remote machine, then wait for its first connection attempt."
        >
          {!connectTicket.ticket ? (
            <p className="text-sm text-[var(--dashboard-ink-muted)]">
              Create the connect link in step 1 to unlock the helper command.
            </p>
          ) : (
            <div className="grid gap-3">
              <code className="block w-full rounded-xl border border-[rgba(0,38,27,0.08)] bg-[rgba(243,244,244,0.95)] px-4 py-3 text-sm text-[var(--dashboard-ink)] [overflow-wrap:anywhere]">
                {connectTicket.ticket.nodeRunCommand}
              </code>
              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  className="h-11 rounded-xl bg-[rgba(220,230,224,0.66)] px-5 text-[var(--dashboard-primary)] hover:bg-[rgba(220,230,224,0.82)]"
                  onClick={() =>
                    void navigator.clipboard.writeText(
                      connectTicket.ticket?.nodeRunCommand ?? "",
                    )
                  }
                >
                  Copy helper command
                </Button>
              </div>
              <div className={`flex items-center gap-2 text-sm ${phaseTone}`}>
                {(wizardPhase === "ticket_ready" || wizardPhase === "waiting_for_device") && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                {phaseMessage}
              </div>
            </div>
          )}
        </WizardStep>

        <WizardStep
          complete={stepThreeComplete}
          active={wizardPhase === "approval_required"}
          index={3}
          title="Approve the device"
          description="Approve the pending device request once the helper appears."
        >
          {wizardPhase === "approval_required" && pendingNodeRequestId ? (
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                disabled={approvingDevice}
                className="h-11 rounded-xl bg-[var(--dashboard-primary)] px-5 text-[var(--dashboard-on-primary)] hover:bg-[var(--dashboard-primary-container)]"
                onClick={() => void handleApproveDevice()}
              >
                {approvingDevice ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    Approving…
                  </span>
                ) : (
                  "Approve device"
                )}
              </Button>
            </div>
          ) : wizardPhase === "reconnecting" ? (
            <div className="flex items-center gap-2 text-sm text-[var(--dashboard-ink-muted)]">
              <Loader2 className="size-4 animate-spin" />
              Reconnecting remote helper…
            </div>
          ) : wizardPhase === "connected" ? (
            <div className="flex items-center gap-2 text-sm text-[#236949]">
              <Loader2 className="size-4 animate-spin" />
              Connected. Redirecting to devices…
            </div>
          ) : (
            <p className="text-sm text-[var(--dashboard-ink-muted)]">
              {stepThreeComplete
                ? "The device request has been approved."
                : wizardPhase === "approval_required"
                  ? "Waiting for the pending device request id."
                  : "Waiting for a single pending device request to appear."}
            </p>
          )}
        </WizardStep>

        {wizardError ? (
          <p className="text-sm text-[#8f3030]">{wizardError}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
