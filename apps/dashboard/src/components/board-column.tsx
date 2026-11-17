import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function ColumnShell({
  id,
  label,
  dot,
  count,
  children,
}: {
  id: string;
  label: string;
  dot: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section
      data-column={id}
      aria-label={label}
      className="flex min-w-60 flex-1 flex-col rounded-2xl border border-border bg-card/50"
    >
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
        <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-full", dot)} />
        <h3 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{label}</h3>
        <Badge variant="outline" size="xs" className="tabular-nums">
          {count}
        </Badge>
      </header>
      <div className="flex flex-1 flex-col gap-3 p-3">{children}</div>
    </section>
  );
}
