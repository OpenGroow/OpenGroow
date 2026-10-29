import type { StatusTone } from "@/components/opengroow/status-badge"

// Canonical UI terms of the Mission statuses (docs/domain/missions.md); the raw
// enum value is never shown to the user.
const MISSION_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  todo: { label: "To do", tone: "neutral" },
  doing: { label: "In progress", tone: "progress" },
  to_validate: { label: "To validate", tone: "warning" },
  approved: { label: "To publish", tone: "info" },
  done: { label: "Done", tone: "active" },
  failed: { label: "Failed", tone: "error" },
  blocked: { label: "Blocked", tone: "warning" },
  cancelled: { label: "Stopped", tone: "neutral" },
}

export function missionStatus(status: string): { label: string; tone: StatusTone } {
  return MISSION_STATUS[status] ?? { label: status, tone: "neutral" }
}

// Run statuses (a Run is one attempt to execute a Mission).
const RUN_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pending: { label: "Queued", tone: "neutral" },
  dispatching: { label: "Starting", tone: "progress" },
  running: { label: "Running", tone: "progress" },
  awaiting_job: { label: "Waiting for job", tone: "progress" },
  completed: { label: "Completed", tone: "active" },
  resumed: { label: "Resumed", tone: "neutral" },
  failed: { label: "Failed", tone: "error" },
  cancelled: { label: "Stopped", tone: "neutral" },
}

export function runStatus(status: string): { label: string; tone: StatusTone } {
  return RUN_STATUS[status] ?? { label: status, tone: "neutral" }
}
