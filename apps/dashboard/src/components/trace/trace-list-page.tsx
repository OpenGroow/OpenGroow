"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/opengroow/page-header";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { runStatus } from "@/components/opengroow/mission-status";
import { DashboardRootSidebar } from "@/src/components/dashboard-root-sidebar";
import { missionRunHref, runTraceHref, TRACE_LIST_HREF } from "@/src/lib/instance-path";
import { titleCase } from "@/src/lib/mission-type";
import { relativeTime } from "@/src/lib/relative-time";
import { formatDurationMs } from "@/src/lib/trace/format-trace";

const PAGE_SIZE = 25;

type Cursor = { createdAt: number; creationTime: number };
const STATUSES = ["pending", "dispatching", "running", "awaiting_job", "completed", "resumed", "failed", "cancelled"] as const;
type RunStatusFilter = (typeof STATUSES)[number];
type Filters = { instanceId?: string; templateId?: string; status?: RunStatusFilter };

/** Recent Runs of Missions and Jobs across the caller's Projects; selecting one opens its Trace. */
export function TraceListPage() {
  const [filters, setFilters] = React.useState<Filters>({});
  // One entry per loaded page (the first has no cursor); a filter change starts over.
  const [cursors, setCursors] = React.useState<Array<Cursor | undefined>>([undefined]);
  const options = useQuery(api.run_trace_list.filterOptions, filters.instanceId ? { instanceId: filters.instanceId } : {});

  function setFilter(key: keyof Filters, value: string) {
    setFilters((current) => ({
      ...current,
      [key]: value === "" ? undefined : value,
      // An Agent of another Project is no longer a valid choice.
      ...(key === "instanceId" ? { templateId: undefined } : {}),
    }));
    setCursors([undefined]);
  }

  return (
    <main className="min-h-screen w-full bg-card xl:grid xl:grid-cols-[320px_minmax(0,1fr)]">
      <DashboardRootSidebar activeHref={TRACE_LIST_HREF} />
      <section className="grid min-w-0 content-start gap-8 px-5 pb-14 pt-8 sm:px-8 xl:px-11 xl:pb-14 xl:pt-13">
        <PageHeader title="Trace" description="What your Agents did in their recent Runs." />
        <div className="grid gap-3 sm:grid-cols-3">
          <NativeSelect
            aria-label="Project"
            data-testid="trace-filter-project"
            value={filters.instanceId ?? ""}
            onChange={(e) => setFilter("instanceId", e.target.value)}
          >
            <option value="">All Projects</option>
            {options?.projects.map((p) => (
              <option key={p.instanceId} value={p.instanceId}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Agent"
            data-testid="trace-filter-agent"
            value={filters.templateId ?? ""}
            onChange={(e) => setFilter("templateId", e.target.value)}
          >
            <option value="">All Agents</option>
            {options?.agents.map((a) => (
              <option key={a.templateId} value={a.templateId}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Status"
            data-testid="trace-filter-status"
            value={filters.status ?? ""}
            onChange={(e) => setFilter("status", e.target.value)}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {runStatus(s).label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-3" data-testid="trace-list">
          {cursors.map((cursor, index) => (
            <TraceRunRows
              key={`${cursor?.createdAt ?? "first"}-${cursor?.creationTime ?? ""}`}
              filters={filters}
              cursor={cursor}
              isLast={index === cursors.length - 1}
              isFirst={index === 0}
              onLoadMore={(next) => setCursors((current) => [...current, next])}
            />
          ))}
        </div>
      </section>
    </main>
  );
}

function TraceRunRows({
  filters,
  cursor,
  isFirst,
  isLast,
  onLoadMore,
}: {
  filters: Filters;
  cursor: Cursor | undefined;
  isFirst: boolean;
  isLast: boolean;
  onLoadMore: (cursor: Cursor) => void;
}) {
  const page = useQuery(api.run_trace_list.listRecent, {
    limit: PAGE_SIZE,
    ...(cursor ? { cursor } : {}),
    ...filters,
  });
  if (page === undefined) return <p className="m-0 text-sm text-muted-foreground">Loading Runs…</p>;
  if (isFirst && page.items.length === 0) {
    return <p className="m-0 text-sm text-muted-foreground">No Runs yet. Runs of your Missions and Jobs appear here.</p>;
  }
  return (
    <>
      {page.items.map((run) => {
        const { label, tone } = runStatus(run.status);
        const href =
          run.kind === "mission" && run.missionId
            ? missionRunHref(run.instanceId, run.missionId, run.runId, "trace")
            : runTraceHref(run.instanceId, run.templateId, run.runId);
        const duration = run.completedAt === null ? undefined : formatDurationMs(run.completedAt - run.createdAt);
        return (
          <Card key={run.runId} className="p-0">
            <Link
              data-testid="trace-run-link"
              href={href}
              className="grid gap-2 rounded-xl px-5 py-4 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4"
            >
              <span className="min-w-0 truncate font-medium text-foreground">
                {run.name ? titleCase(run.name) : run.kind === "mission" ? "Mission" : "Job"}
              </span>
              <span className="min-w-0 truncate text-sm text-muted-foreground">{run.agentName}</span>
              <span className="min-w-0 truncate text-sm text-muted-foreground">{run.projectName ?? "Project"}</span>
              <span className="text-sm text-muted-foreground" title={new Date(run.createdAt).toLocaleString()}>
                {relativeTime(run.createdAt)}
                {duration ? ` · ${duration}` : ""}
              </span>
              <StatusBadge tone={tone} label={label} />
            </Link>
          </Card>
        );
      })}
      {isLast && page.nextCursor ? (
        <Button type="button" variant="outline" className="w-fit" onClick={() => onLoadMore(page.nextCursor as Cursor)}>
          Load more
        </Button>
      ) : null}
    </>
  );
}
