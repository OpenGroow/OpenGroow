import { Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type FilterOption = { id: string; label: string; count?: number }

/** Single-choice filter chips; the pressed chip carries the blue selection. */
function FilterChips({
  options,
  value,
  onChange,
  label,
}: {
  options: FilterOption[]
  value: string
  onChange: (id: string) => void
  label: string
}) {
  return (
    <div className="flex flex-wrap gap-3" role="group" aria-label={label}>
      {options.map((option) => (
        <Button
          key={option.id}
          type="button"
          size="lg"
          variant="outline"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
        >
          {option.label}
          {option.count !== undefined ? (
            <span className="rounded-md bg-muted px-1.5 text-sm text-muted-foreground tabular-nums">
              {option.count}
            </span>
          ) : null}
        </Button>
      ))}
    </div>
  )
}

function SearchField({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder: string
}) {
  return (
    <div className="relative w-full lg:w-80">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 pl-11"
      />
    </div>
  )
}

export { FilterChips, SearchField, type FilterOption }
