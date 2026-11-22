import { StatusBadge } from "@/components/opengroow/status-badge";

/** Active or Archived badge of a Creative Family (ADR-082). */
export function FamilyStatusBadge({ status, size }: { status: "active" | "archived"; size?: "default" }) {
  return <StatusBadge size={size} tone={status === "archived" ? "neutral" : "active"} label={status === "archived" ? "Archived" : "Active"} />;
}
