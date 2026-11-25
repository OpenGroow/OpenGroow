"use client";

import { use, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { CalendarDays, ChevronLeft, ChevronRight, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MonthGrid } from "@/src/components/editorial-calendar-grid";
import { Details } from "@/src/components/editorial-calendar-details";
import { formatDay } from "@/src/components/content-plan-types";
import { dayKey, daysIn, monthLabel, shift, type CalendarItem, type MonthKey } from "@/src/components/editorial-calendar-types";

// The Editorial Calendar page (ADR-086): the approved Planned Contents of every Content Plan of the Project, by planned
// day. Strictly read-only. A planned day is an intention: nothing here is a scheduled Publication.

type Props = { params: Promise<{ instanceId: string }> };

export function EditorialCalendarPage({ params }: Props) {
  const { instanceId } = use(params);
  return <EditorialCalendarContent instanceId={decodeURIComponent(instanceId)} />;
}

export function EditorialCalendarContent({ instanceId }: { instanceId: string }) {
  const [cursor, setCursor] = useState<MonthKey>(() => {
    const now = new Date();
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() };
  });
  const [view, setView] = useState<"month" | "list">("month");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const from = dayKey(cursor.year, cursor.month, 1);
  const to = dayKey(cursor.year, cursor.month, daysIn(cursor));
  const result = useQuery(api.editorial_calendar.range, { instanceId, from, to }) as { items: CalendarItem[]; truncated: boolean } | undefined;
  const items = result?.items;
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items ?? []) {
      const day = map.get(item.plannedAt);
      if (day) day.push(item);
      else map.set(item.plannedAt, [item]);
    }
    return map;
  }, [items]);
  const sorted = useMemo(() => [...(items ?? [])].sort((a, b) => a.plannedAt.localeCompare(b.plannedAt)), [items]);
  const itemsById = useMemo(() => new Map((items ?? []).map((item) => [item._id, item])), [items]);
  const selected = (selectedId !== null ? itemsById.get(selectedId) : undefined) ?? null;
  const go = (by: number) => {
    setCursor((c) => shift(c, by));
    setSelectedId(null);
  };

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
      <header className="flex min-w-0 items-center gap-4">
        <div aria-hidden="true" className="flex size-14 shrink-0 items-center justify-center rounded-2xl border bg-primary/10 text-primary">
          <CalendarDays className="size-7" />
        </div>
        <div className="grid min-w-0 gap-1">
          <h1 className="m-0 break-words text-3xl font-bold tracking-tight sm:text-4xl">Editorial Calendar</h1>
          <p className="m-0 text-muted-foreground">A monthly calendar of your approved, planned content — see what&apos;s planned and when.</p>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="icon-sm" className="rounded-lg" aria-label="Previous month" onClick={() => go(-1)}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button type="button" variant="outline" size="icon-sm" className="rounded-lg" aria-label="Next month" onClick={() => go(1)}>
          <ChevronRight aria-hidden="true" />
        </Button>
        <h2 className="m-0 text-2xl font-semibold">{monthLabel(cursor)}</h2>
        <div className="h-6 w-px bg-border" aria-hidden="true" />
        <Button type="button" variant="outline" size="sm" onClick={() => { const n = new Date(); setCursor({ year: n.getUTCFullYear(), month: n.getUTCMonth() }); setSelectedId(null); }}>Today</Button>
        <div className="ml-auto flex gap-1 rounded-lg border p-1">
          <Button type="button" size="sm" variant={view === "month" ? "default" : "ghost"} aria-pressed={view === "month"} onClick={() => setView("month")}>
            <CalendarDays aria-hidden="true" />
            Month
          </Button>
          <Button type="button" size="sm" variant={view === "list" ? "default" : "ghost"} aria-pressed={view === "list"} onClick={() => setView("list")}>
            <List aria-hidden="true" />
            List
          </Button>
        </div>
      </div>
      <div role="status" className="min-h-5 text-sm text-muted-foreground">
        {items === undefined
          ? "Loading…"
          : result?.truncated
            ? <span className="text-foreground">This month holds more contents than can be shown here: only the first {items.length} are listed.</span>
            : items.length === 0
              ? "No approved content this month."
              : null}
      </div>
      {items === undefined ? null : (
        <>
          {view === "month" ? (
            <MonthGrid cursor={cursor} byDay={byDay} selectedId={selectedId} onSelect={setSelectedId} />
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {sorted.map((item) => (
                <li key={item._id} data-content={item._id}>
                  <Button type="button" variant="outline" aria-pressed={selectedId === item._id} className="h-auto w-full justify-start gap-3 whitespace-normal px-3 py-3 text-left" onClick={() => setSelectedId(item._id)}>
                    <span className="text-sm text-muted-foreground">{formatDay(item.plannedAt)}</span>
                    <span className="font-semibold">{item.title}</span>
                    <span className="text-sm font-normal text-muted-foreground">{item.kind} · {item.publishTargets.join(", ")}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {selected ? <Details item={selected} instanceId={instanceId} /> : null}
        </>
      )}
    </div>
  );
}
