import Link from "next/link"

import { cn } from "@/lib/utils"

type TabNavItem = {
  label: string
  href: string
  /** A disabled tab stays visible but is not a link. */
  enabled?: boolean
}

/**
 * Underlined section tabs: plain labels on a hairline, the current one in the
 * primary colour with a marker over the line. `current` is the href of the
 * active tab; the caller decides how it matches the pathname.
 */
function TabNav({
  items,
  current,
  label,
  className,
}: {
  items: TabNavItem[]
  current: string | undefined
  label: string
  className?: string
}) {
  return (
    <nav
      data-slot="tab-nav"
      aria-label={label}
      className={cn("flex flex-wrap gap-x-8 border-b border-border", className)}
    >
      {items.map((item) => {
        const base =
          "relative -mb-px border-b-2 px-0.5 pt-1 pb-3 text-base font-medium transition-colors"
        if (item.enabled === false) {
          return (
            <span
              key={item.href}
              aria-disabled="true"
              className={cn(base, "cursor-not-allowed border-transparent text-muted-foreground opacity-40")}
            >
              {item.label}
            </span>
          )
        }
        const active = item.href === current
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              base,
              active
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

export { TabNav, type TabNavItem }
