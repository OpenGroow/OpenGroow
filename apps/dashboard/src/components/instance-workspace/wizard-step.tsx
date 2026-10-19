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
      className={`grid gap-3 rounded-xl border p-5 ${
        active
          ? "border-border bg-muted"
          : complete
            ? "border-border bg-muted/50 opacity-70"
            : "border-border bg-muted/50 opacity-60"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
          {index}
        </div>
        <div className="grid gap-2">
          <h4 className="text-base font-semibold text-foreground">
            {title}
          </h4>
          {description ? (
            <p className="text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}
