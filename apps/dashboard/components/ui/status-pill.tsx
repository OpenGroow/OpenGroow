import { cn } from "@/lib/utils"

// Shared shell for the dashboard's small uppercase status pills — several
// feature pages (Agents, Sources) each grew their own near-identical
// `rounded-full` span with a per-status color map; this is the one shape
// they render into, keyed by whatever tone classes the caller resolves.
export function StatusPill({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "w-fit rounded-full px-3 py-1 text-[0.72rem] font-bold uppercase tracking-[0.16em]",
        className,
      )}
    >
      {label}
    </span>
  )
}
