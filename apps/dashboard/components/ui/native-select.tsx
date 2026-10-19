"use client"

import * as React from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

type Option = { value: string; label: string; disabled?: boolean }

function optionsOf(children: React.ReactNode): Option[] {
  const options: Option[] = []
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement<React.ComponentProps<"option">>(child)) return
    const { value, children: label, disabled } = child.props
    options.push({
      value: String(value ?? label ?? ""),
      label: React.Children.toArray(label).join(""),
      disabled,
    })
  })
  return options
}

// Plain value/onChange select, for fields where the base-ui `Select` contract
// (items + onValueChange) would change the form. The menu is drawn by the
// shared `Select` (no check mark, styled like the rest of the product); a
// visually hidden native `<select>` stays in the DOM as the form control, so
// `name`, `required`, forms and `onChange(e.target.value)` keep working.
// `className` is for layout only (width, height) and lands on the wrapper.
function NativeSelect({
  className,
  children,
  value,
  onChange,
  "aria-label": ariaLabel,
  disabled,
  ...props
}: React.ComponentProps<"select">) {
  const nativeRef = React.useRef<HTMLSelectElement>(null)
  const options = optionsOf(children)

  function handleValueChange(next: string | null) {
    const el = nativeRef.current
    if (!el || next === null) return
    // Go through the native element so React's onChange sees a real event.
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set
    setter?.call(el, next)
    el.dispatchEvent(new Event("change", { bubbles: true }))
  }

  return (
    <div data-slot="native-select-wrapper" className={cn("relative h-10 w-full min-w-0", className)}>
      <select
        ref={nativeRef}
        data-slot="native-select"
        aria-hidden="true"
        tabIndex={-1}
        className="sr-only"
        value={value}
        onChange={onChange}
        disabled={disabled}
        {...props}
      >
        {children}
      </select>
      <Select
        value={value === undefined ? undefined : String(value)}
        onValueChange={handleValueChange}
        disabled={disabled}
        items={options.map(({ value: v, label }) => ({ value: v, label }))}
      >
        <SelectTrigger
          aria-label={ariaLabel}
          className="w-full min-w-0 pr-3.5 pl-3 text-base data-[size=default]:h-full md:text-sm"
        >
          <SelectValue className="truncate" />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              indicator={false}
              className="pr-1.5 data-[selected]:bg-muted data-[selected]:font-medium"
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export { NativeSelect }
