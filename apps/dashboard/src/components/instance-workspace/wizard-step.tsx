import type { ConnectSessionStatus } from "@/src/components/instance-workspace.types";

export type ConnectWizardPhase =
  | "idle"
  | "ticket_ready"
  | "waiting_for_device"
  | "approval_required"
  | "reconnecting"
  | "connected"
  | "failed"
  | "expired";

export function getWizardPhaseMessage({
  pendingNodeRequestCount,
  phase,
  sessionStatus,
}: {
  pendingNodeRequestCount: number;
  phase: ConnectWizardPhase;
  sessionStatus?: ConnectSessionStatus;
}) {
  if (phase === "ticket_ready" || phase === "waiting_for_device") {
    return "Waiting for remote device to attempt connection.";
  }
  if (phase === "approval_required") {
    return pendingNodeRequestCount > 0
      ? "Device approval required."
      : "Approval required. Waiting for the device request to be indexed.";
  }
  if (phase === "reconnecting") {
    return "Reconnecting remote helper…";
  }
  if (phase === "connected") {
    return "Connected.";
  }
  if (phase === "expired") {
    return "Ticket expired. Generate a new connect link.";
  }
  if (phase === "failed") {
    return sessionStatus?.error ?? "Connect link flow failed.";
  }
  return "Create a connect link to begin.";
}

export function WizardStep({
  active,
  children,
  complete,
  description,
  index,
  title,
}: {
  active: boolean;
  children: React.ReactNode;
  complete: boolean;
  description?: string;
  index: number;
  title: string;
}) {
  return (
    <div
      className={`grid gap-3 rounded-[1.25rem] border p-5 ${
        active
          ? "border-[rgba(0,38,27,0.08)] bg-[rgba(243,244,244,0.75)]"
          : complete
            ? "border-[rgba(0,38,27,0.06)] bg-[rgba(243,244,244,0.45)] opacity-70"
            : "border-[rgba(0,38,27,0.06)] bg-[rgba(243,244,244,0.45)] opacity-60"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--dashboard-primary)] text-sm font-semibold text-[var(--dashboard-on-primary)]">
          {index}
        </div>
        <div className="grid gap-2">
          <h4 className="text-base font-semibold text-[var(--dashboard-ink)]">
            {title}
          </h4>
          {description ? (
            <p className="text-sm leading-6 text-[var(--dashboard-ink-muted)]">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}
