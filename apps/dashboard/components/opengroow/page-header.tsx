import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * Title block shared by every page: a large title, an optional one-line
 * description and at most one primary action at the upper right (DESIGN.md
 * "Layout and navigation"). The spotlight behind it lives in the app shell.
 */
function PageHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <header
      data-slot="page-header"
      className={cn(
        "flex flex-col items-start justify-between gap-5 lg:flex-row lg:items-center",
        className
      )}
    >
      <div className="grid min-w-0 gap-2">
        <h1 className="m-0 text-4xl font-bold tracking-tight break-words text-foreground sm:text-5xl">
          {title}
        </h1>
        {description ? (
          <p className="m-0 max-w-2xl text-lg text-muted-foreground sm:text-xl">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  )
}

export { PageHeader }
