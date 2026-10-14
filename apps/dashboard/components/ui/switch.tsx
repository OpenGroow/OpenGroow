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
        "relative inline-flex h-8 w-[3.5rem] shrink-0 items-center rounded-full border outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        "data-[checked]:border-[var(--dashboard-primary)] data-[checked]:bg-[var(--dashboard-primary)]",
        "data-[unchecked]:border-[rgba(0,38,27,0.12)] data-[unchecked]:bg-white",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-6 rounded-full bg-white shadow-[0_4px_14px_rgba(0,0,0,0.16)] transition-transform",
          "data-[checked]:translate-x-[1.45rem] data-[unchecked]:translate-x-1",
          thumbClassName,
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
