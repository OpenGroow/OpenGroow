import { StatusBadge } from "@/components/opengroow/status-badge";
import type { WorkspaceStatusTone } from "@/src/components/instance-workspace.types";

export function WorkspaceStatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: WorkspaceStatusTone;
}) {
  return <StatusBadge tone={tone === "success" ? "active" : "neutral"} label={label} />;
}
