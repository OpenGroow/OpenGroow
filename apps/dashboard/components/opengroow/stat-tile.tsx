import type { LucideIcon } from "lucide-react"

import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

import { AGENT_TONE_CLASSES } from "@/components/opengroow/agent-presentation"

// Only used for aggregates backed by real data (DESIGN.md: no filler metrics).
function StatTile({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon: LucideIcon
  label: string
  value: number | string
  className?: string
}) {
  return (
    <Card
      data-slot="stat-tile"
      className={cn("flex-row items-center gap-5 px-6 py-6", className)}
    >
      <span
        aria-hidden="true"
        className={cn("flex size-14 shrink-0 items-center justify-center rounded-xl", AGENT_TONE_CLASSES.neutral)}
      >
        <Icon className="size-7" />
      </span>
      <div className="grid gap-0.5">
        <div className="flex items-center gap-2 text-4xl leading-none font-semibold tabular-nums text-foreground">
          {value}
        </div>
        <div className="text-base text-muted-foreground">{label}</div>
      </div>
    </Card>
  )
}

export { StatTile }
