"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatIcon } from "@/src/components/editorial-calendar-format";
import { dayKey, daysIn, formatLabel, intentLabel, type CalendarItem, type MonthKey } from "@/src/components/editorial-calendar-types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A planned content inside a day cell: title on up to two lines, then its format and intent. */
function DayChip({ item, selected, onSelect }: { item: CalendarItem; selected: boolean; onSelect: (id: string) => void }) {
  const Icon = formatIcon(item.kind);
  return (
    <Button
      type="button"
      variant="outline"
      aria-pressed={selected}
      className={cn("h-auto w-full min-w-0 flex-col items-start justify-start gap-1.5 whitespace-normal rounded-lg bg-muted/40 p-2 text-left", selected && "ring-2 ring-primary")}
      onClick={() => onSelect(item._id)}
    >
      <span className="line-clamp-2 w-full break-words text-xs font-medium">{item.title}</span>
      <span className="flex min-w-0 flex-wrap gap-1">
        <Badge variant="tag" size="xs">
          <Icon aria-hidden="true" />
          {formatLabel(item.kind)}
        </Badge>
        <Badge variant="tag" size="xs">{intentLabel(item.intent)}</Badge>
      </span>
    </Button>
  );
}

export function MonthGrid({ cursor, byDay, selectedId, onSelect }: { cursor: MonthKey; byDay: Map<string, CalendarItem[]>; selectedId: string | null; onSelect: (id: string) => void }) {
  const lead = (new Date(Date.UTC(cursor.year, cursor.month, 1)).getUTCDay() + 6) % 7; // Monday first
  const cells: Array<number | null> = [...Array<null>(lead).fill(null), ...Array.from({ length: daysIn(cursor) }, (_, i) => i + 1)];
  return (
    <div className="grid min-w-0 grid-cols-[repeat(7,minmax(0,1fr))] gap-1.5" role="grid" aria-label="Month">
      {WEEKDAYS.map((name) => (
        <div key={name} className="px-1 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">{name}</div>
      ))}
      {cells.map((day, index) => {
        if (day === null) return <div key={`pad-${index}`} />;
        const key = dayKey(cursor.year, cursor.month, day);
        const dayItems = byDay.get(key) ?? [];
        return (
          <div key={key} data-day={key} className="grid min-h-24 min-w-0 content-start gap-2 rounded-xl border bg-card/40 p-2.5">
            <span className={cn("px-0.5 text-sm leading-none text-muted-foreground", dayItems.length > 0 && "font-bold text-foreground")}>{day}</span>
            {dayItems.map((item) => (
              <DayChip key={item._id} item={item} selected={selectedId === item._id} onSelect={onSelect} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
