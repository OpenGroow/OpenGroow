import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

// The product's status vocabulary (DESIGN.md "Status vocabulary"):
// active = live or successful (the only green), progress = a process running,
// info = inactive or informational, warning, error, neutral = paused / queued /
// unavailable. Colour lives in the dot and the border; the label stays light
// and is always shown, so colour is never the only signal.
type StatusTone = "active" | "info" | "progress" | "warning" | "error" | "neutral"

const TONES: Record<StatusTone, { pill: string; dot: string }> = {
  active: { pill: "border-tone-green/35 bg-tone-green/10", dot: "bg-tone-green" },
  info: { pill: "border-tone-blue/30 bg-tone-blue/10", dot: "bg-tone-blue" },
  progress: { pill: "border-brand-cyan/35 bg-brand-cyan/10", dot: "bg-brand-cyan animate-pulse" },
  warning: { pill: "border-status-warning/35 bg-status-warning/10", dot: "bg-status-warning" },
  error: { pill: "border-status-error/35 bg-status-error/10", dot: "bg-status-error" },
  neutral: { pill: "border-border bg-muted/50", dot: "bg-status-paused" },
}

function StatusBadge({
  tone,
  label,
  className,
}: {
  tone: StatusTone
  label: string
  className?: string
}) {
  const { pill, dot } = TONES[tone]
  return (
    <Badge
      data-slot="status-badge"
      variant="outline"
      size="xs"
      className={cn("text-foreground", pill, className)}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", dot)} />
      {label}
    </Badge>
  )
}

export { StatusBadge, type StatusTone }
