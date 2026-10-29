import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

// Compact tile for a live count with a coloured dot (same colour as the
// matching Kanban column). The label always sits next to the dot, so colour is
// never the only signal. Only for counts backed by real data.
function CountTile({
  label,
  value,
  dotClassName,
  className,
}: {
  label: string
  value: number
  dotClassName: string
  className?: string
}) {
  return (
    <Card data-slot="count-tile" className={cn("gap-3 px-5 py-4", className)}>
      <div className="flex items-center gap-2.5 text-sm text-foreground">
        <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-full", dotClassName)} />
        {label}
      </div>
      <div className="text-3xl leading-none font-semibold tabular-nums text-foreground">{value}</div>
    </Card>
  )
}

export { CountTile }
