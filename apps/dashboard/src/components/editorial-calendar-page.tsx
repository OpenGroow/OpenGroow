"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/opengroow/page-header";

// The Editorial Calendar page (ADR-086): the approved Planned Contents of every Content Plan of the Project, by planned
// day. Strictly read-only. A planned day is an intention: nothing here is a scheduled Publication.

export type CalendarItem = {
  _id: string;
  planId: string;
  kind: string;
  title: string;
  brief: string;
  plannedAt: string;
  intent: "explore" | "exploit";
  rationale: string;
  publishTargets: string[];
  plan: { periodStart: string; periodEnd: string } | null;
};

type MonthKey = { year: number; month: number }; // month: 0-11
const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;
const daysIn = ({ year, month }: MonthKey) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
const shift = ({ year, month }: MonthKey, by: number): MonthKey => {
  const d = new Date(Date.UTC(year, month + by, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
};
const monthLabel = ({ year, month }: MonthKey) => new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const formatDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
    for (const item of items ?? []) map.set(item.plannedAt, [...(map.get(item.plannedAt) ?? []), item]);
    return map;
  }, [items]);
  const selected = items?.find((item) => item._id === selectedId) ?? null;
  const go = (by: number) => {
    setCursor((c) => shift(c, by));
    setSelectedId(null);
  };

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader title="Editorial Calendar" description="The contents you approved, on the day they are planned for. This calendar is read-only." />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" aria-label="Previous month" onClick={() => go(-1)}>‹</Button>
        <h2 className="m-0 min-w-40 text-center text-xl font-semibold">{monthLabel(cursor)}</h2>
        <Button type="button" variant="outline" size="sm" aria-label="Next month" onClick={() => go(1)}>›</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => { const n = new Date(); setCursor({ year: n.getUTCFullYear(), month: n.getUTCMonth() }); setSelectedId(null); }}>Today</Button>
        <div className="ml-auto flex gap-1">
          <Button type="button" size="sm" variant={view === "month" ? "default" : "outline"} onClick={() => setView("month")}>Month</Button>
          <Button type="button" size="sm" variant={view === "list" ? "default" : "outline"} onClick={() => setView("list")}>List</Button>
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
              {[...items].sort((a, b) => a.plannedAt.localeCompare(b.plannedAt)).map((item) => (
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

function MonthGrid({ cursor, byDay, selectedId, onSelect }: { cursor: MonthKey; byDay: Map<string, CalendarItem[]>; selectedId: string | null; onSelect: (id: string) => void }) {
  const lead = (new Date(Date.UTC(cursor.year, cursor.month, 1)).getUTCDay() + 6) % 7; // Monday first
  const cells: Array<number | null> = [...Array<null>(lead).fill(null), ...Array.from({ length: daysIn(cursor) }, (_, i) => i + 1)];
  return (
    <div className="grid min-w-0 grid-cols-[repeat(7,minmax(0,1fr))] gap-1" role="grid" aria-label="Month">
      {WEEKDAYS.map((name) => (
        <div key={name} className="px-1 text-xs font-medium text-muted-foreground">{name}</div>
      ))}
      {cells.map((day, index) => {
        if (day === null) return <div key={`pad-${index}`} />;
        const key = dayKey(cursor.year, cursor.month, day);
        return (
          <div key={key} data-day={key} className="grid min-h-24 min-w-0 content-start gap-1 rounded-md border p-1">
            <span className="text-xs text-muted-foreground">{day}</span>
            {(byDay.get(key) ?? []).map((item) => (
              <Button
                key={item._id}
                type="button"
                size="xs"
                variant="outline"
                aria-pressed={selectedId === item._id}
                className="w-full justify-start overflow-hidden"
                onClick={() => onSelect(item._id)}
              >
                <span className="truncate">{item.title}</span>
              </Button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Details({ item, instanceId }: { item: CalendarItem; instanceId: string }) {
  return (
    <section aria-label="Content details">
      <Card className="grid gap-2 p-4">
        <h3 className="m-0 text-lg font-semibold">{item.title}</h3>
        <p className="m-0 text-sm text-muted-foreground">
          {formatDay(item.plannedAt)} · {item.kind} · {item.intent === "explore" ? "Explore" : "Exploit"}
        </p>
        <p className="m-0 text-sm">{item.brief}</p>
        <p className="m-0 text-sm text-muted-foreground">{item.rationale}</p>
        <p className="m-0 text-sm">Targets: {item.publishTargets.join(", ")}</p>
        <Link href={`/projects/${encodeURIComponent(instanceId)}/content-plans#plan-${item.planId}`} className="text-sm text-primary underline underline-offset-4">
          View the originating plan{item.plan ? ` (${formatDay(item.plan.periodStart)} to ${formatDay(item.plan.periodEnd)})` : ""}
        </Link>
      </Card>
    </section>
  );
}
