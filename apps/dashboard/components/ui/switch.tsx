"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

function Switch({
  className,
  thumbClassName,
  ...props
}: SwitchPrimitive.Root.Props & { thumbClassName?: string }) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        "data-[checked]:bg-primary data-[unchecked]:bg-input",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-foreground transition-transform",
          "data-[checked]:translate-x-[1.125rem] data-[unchecked]:translate-x-0.5",
          thumbClassName,
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
