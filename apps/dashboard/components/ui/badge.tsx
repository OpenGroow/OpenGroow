import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Generic label shapes only. Product statuses (active, in progress, failed...)
// go through `StatusBadge` (components/opengroow/status-badge.tsx), which owns
// the status vocabulary and its colours.
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border border-transparent text-sm leading-none font-medium whitespace-nowrap tabular-nums [&_svg]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-primary/15 text-primary",
        secondary: "bg-secondary text-secondary-foreground",
        outline: "border-border text-muted-foreground",
        tag: "rounded-lg border-border bg-muted/60 text-foreground",
      },
      size: {
        xs: "gap-1 px-2 py-0.5 text-xs",
        default: "px-3 py-1.5",
        lg: "px-4 py-2 text-base",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  }
)

function Badge({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  )
}

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>

export { Badge, badgeVariants, type BadgeVariant }
