import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const ICON_TONE = {
  violet: "bg-tone-violet-soft text-tone-violet",
  cyan: "bg-tone-cyan-soft text-tone-cyan",
  blue: "bg-tone-blue-soft text-tone-blue",
} as const

/** The tinted icon tile that opens a settings card. */
function PanelIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: keyof typeof ICON_TONE }) {
  return (
    <span
      aria-hidden="true"
      className={cn("flex size-12 shrink-0 items-center justify-center rounded-xl", ICON_TONE[tone])}
    >
      <Icon className="size-6" />
    </span>
  )
}

/**
 * A settings form in one card: a tinted icon tile, a title and description,
 * the fields, then Cancel / Save changes. Both buttons stay disabled until
 * `dirty`; Cancel resets the draft through `onCancel`.
 */
function SettingsPanel({
  icon,
  tone,
  title,
  description,
  dirty,
  saving,
  error,
  onSave,
  onCancel,
  children,
  className,
}: {
  icon: LucideIcon
  tone: keyof typeof ICON_TONE
  title: ReactNode
  description: ReactNode
  dirty: boolean
  saving: boolean
  error?: string
  onSave: () => void
  onCancel: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <Card data-slot="settings-panel" className={cn("max-w-3xl", className)}>
      <CardContent className="grid gap-6">
        <div className="flex items-start gap-4">
          <PanelIcon icon={icon} tone={tone} />
          <div className="grid gap-1">
            <h2 className="m-0 text-lg font-semibold text-foreground">{title}</h2>
            <p className="m-0 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        {children}
        {error ? <p className="m-0 text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" size="lg" disabled={saving || !dirty} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" size="lg" loading={saving} disabled={!dirty} onClick={onSave}>
            Save changes
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * A read-and-act settings card: the icon tile on the left, and to its right
 * the title, the description and the body (a field, a value, an action).
 */
function SettingsCard({
  icon,
  tone,
  title,
  description,
  children,
  className,
}: {
  icon: LucideIcon
  tone: keyof typeof ICON_TONE
  title: ReactNode
  description: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card data-slot="settings-card" className={className}>
      <CardContent className="flex items-start gap-5">
        <PanelIcon icon={icon} tone={tone} />
        <div className="grid min-w-0 flex-1 gap-5">
          <div className="grid gap-1">
            <h2 className="m-0 text-lg font-semibold text-foreground">{title}</h2>
            <p className="m-0 text-sm text-muted-foreground">{description}</p>
          </div>
          {children}
        </div>
      </CardContent>
    </Card>
  )
}

export { PanelIcon, SettingsCard, SettingsPanel }
