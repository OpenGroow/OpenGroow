"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import { runLogsHref } from "@/src/lib/instance-path";
import { formatCadence, WEEKDAYS } from "@/src/components/instance-schedules-page";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/opengroow/page-header";
import { StatusBadge, type StatusTone } from "@/components/opengroow/status-badge";
import { StatTile } from "@/components/opengroow/stat-tile";
import { FilterChips, SearchField } from "@/components/opengroow/filter-bar";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  CalendarDays,
  CircleCheck,
  CircleX,
  Layers,
  LoaderCircle,
  ChartColumn,
  Clock,
  Download,
  Ellipsis,
  Pause,
  Play,
  Route,
  ScrollText,
  TimerReset,
  Workflow,
  type LucideIcon,
} from "lucide-react";

type Props = {
  params: Promise<{ instanceId: string }>;
};

export function InstanceJobsPage({ params }: Props) {
  const { instanceId } = use(params);
  return <InstanceJobsContent instanceId={decodeURIComponent(instanceId)} />;
}

// `_id` stays a plain string-compatible id so fixtures stay lightweight.
type JobRow = Pick<
  Doc<"jobs">,
  "type" | "state" | "unit" | "dayOfWeek" | "dayOfMonth" | "hour" | "minute" | "timezone" | "nextRunAt" | "lastRunAt" | "lastOutcome" | "lastError"
> & {
  _id: string;
  templateId: string;
  agentName: string;
  label: string;
  running: boolean;
  workspaceKey?: string;
  latestRunId?: string;
};

type Unit = Doc<"jobs">["unit"];

function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}

type JobStatus = "running" | "paused" | "failed" | "active";

// A paused job stays Paused whatever its last outcome; `skipped` is not a
// failure, so it leaves the job Active.
function statusOf(job: JobRow): JobStatus {
  if (job.state === "paused") return "paused";
  if (job.running) return "running";
  return job.lastOutcome === "failed" ? "failed" : "active";
}

const STATUS_BADGES: Record<JobStatus, { tone: StatusTone; label: string }> = {
  running: { tone: "progress", label: "Running" },
  paused: { tone: "neutral", label: "Paused" },
  failed: { tone: "error", label: "Failed" },
  active: { tone: "active", label: "Active" },
};

const STATUS_FILTERS = ["running", "paused", "failed"] as const;

const SORTS = {
  activity: "Latest activity",
  next: "Next run",
  name: "Name",
} as const;
type Sort = keyof typeof SORTS;

function compareJobs(sort: Sort): (a: JobRow, b: JobRow) => number {
  if (sort === "name") return (a, b) => a.label.localeCompare(b.label);
  if (sort === "next") return (a, b) => a.nextRunAt - b.nextRunAt;
  return (a, b) => (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0);
}

export function InstanceJobsContent({ instanceId }: { instanceId: string }) {
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState<Sort>("activity");
  const [search, setSearch] = useState("");
  const jobs = useQuery(api.jobs.listByInstance, { instanceId }) as JobRow[] | undefined;

  const needle = search.trim().toLowerCase();
  const visible = (jobs ?? [])
    .filter(
      (job) =>
        (filter === "all" || statusOf(job) === filter) &&
        (needle === "" || `${job.label} ${job.agentName}`.toLowerCase().includes(needle)),
    )
    .sort(compareJobs(sort));
  const chips = [
    { id: "all", label: "All", count: jobs?.length ?? 0 },
    ...STATUS_FILTERS.map((id) => ({
      id,
      label: STATUS_BADGES[id].label,
      count: (jobs ?? []).filter((job) => statusOf(job) === id).length,
    })),
  ];

  return (
    <div className="grid gap-8">
      <PageHeader title="Jobs" description="Executions, schedules, logs and retries." />

      {jobs === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No jobs yet. Jobs appear here when an Agent with scheduled capabilities is activated.
        </p>
      ) : (
        <>
        <section aria-label="Job counts" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatTile icon={Layers} label="Total jobs" value={jobs.length} tone="visual" />
          <StatTile
            icon={CircleCheck}
            label="Active"
            value={jobs.filter((job) => statusOf(job) === "active").length}
            tone="engagement"
          />
          <StatTile
            icon={LoaderCircle}
            label="Running"
            value={jobs.filter((job) => statusOf(job) === "running").length}
            tone="research"
          />
          <StatTile icon={Pause} label="Paused" value={jobs.filter((job) => statusOf(job) === "paused").length} />
          <StatTile
            icon={CircleX}
            label="Failed"
            value={jobs.filter((job) => statusOf(job) === "failed").length}
            tone="error"
          />
        </section>

        <section className="grid gap-5">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <FilterChips options={chips} value={filter} onChange={setFilter} label="Filter by status" />
            <div className="flex flex-col gap-3 sm:flex-row">
              <SearchField value={search} onChange={setSearch} label="Search jobs" placeholder="Search jobs…" />
              <NativeSelect
                aria-label="Sort jobs"
                className="h-11 sm:w-48"
                value={sort}
                onChange={(event) => setSort(event.target.value as Sort)}
              >
                {Object.entries(SORTS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs match these filters.</p>
          ) : (
            <ul className="grid gap-4">
              {visible.map((job) => (
                <JobRowItem key={job._id} job={job} instanceId={instanceId} />
              ))}
            </ul>
          )}
        </section>
        </>
      )}
    </div>
  );
}

// The leading tile tells the kind of work a job does; unknown types fall back
// to a neutral glyph.
const JOB_ICONS: Record<string, { icon: LucideIcon; tone: string }> = {
  source_ingestion: { icon: Download, tone: "bg-tone-violet-soft text-tone-violet" },
  source_scoring: { icon: ChartColumn, tone: "bg-tone-blue-soft text-tone-blue" },
  source_routing: { icon: Route, tone: "bg-tone-cyan-soft text-tone-cyan" },
};
const FALLBACK_ICON = { icon: Workflow, tone: "bg-tone-slate-soft text-tone-slate" };

// `skipped` is not an error: the previous execution was still running.
function Outcome({ job }: { job: JobRow }) {
  if (job.lastOutcome === undefined) {
    return <p className="m-0 text-sm text-muted-foreground">Last outcome: none yet</p>;
  }
  if (job.lastOutcome === "skipped") {
    return (
      <p className="m-0 text-sm text-muted-foreground">
        Last outcome: Skipped — the previous execution was still running.
      </p>
    );
  }
  if (job.lastOutcome === "failed") {
    return (
      <div className="grid gap-1">
        <p className="m-0 text-sm font-medium text-status-error">Last outcome: Failed</p>
        {job.lastError ? (
          <p role="alert" className="m-0 break-words text-sm text-muted-foreground">
            {job.lastError}
          </p>
        ) : null}
      </div>
    );
  }
  // Success needs no label; the agent's summary is written for agents, not shown here.
  return null;
}

function JobRowItem({ job, instanceId }: { job: JobRow; instanceId: string }) {
  const pauseJob = useMutation(api.jobs.pause);
  const resumeJob = useMutation(api.jobs.resume);
  const runNowJob = useMutation(api.jobs.runNow);
  const [editing, setEditing] = useState(false);

  async function toggle(): Promise<void> {
    try {
      const jobId = job._id as Id<"jobs">;
      await (job.state === "active" ? pauseJob({ jobId }) : resumeJob({ jobId }));
    } catch (error: unknown) {
      window.alert(extractConvexErrorMessage(error, "Failed to update the job."));
    }
  }

  async function runNow(): Promise<void> {
    try {
      await runNowJob({ jobId: job._id as Id<"jobs"> });
    } catch (error: unknown) {
      window.alert(
        extractConvexErrorMessage(
          error,
          `Failed to run the ${job.label} job.`,
        ),
      );
    }
  }

  const { icon: Icon, tone } = JOB_ICONS[job.type] ?? FALLBACK_ICON;
  const badge = STATUS_BADGES[statusOf(job)];
  return (
    <li>
      <Card className="gap-4 px-6 py-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div className="flex min-w-0 gap-4">
            <span
              aria-hidden="true"
              className={cn("flex size-14 shrink-0 items-center justify-center rounded-xl", tone)}
            >
              <Icon className="size-6" />
            </span>
            <div className="grid min-w-0 gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="m-0 text-xl font-semibold text-foreground">{job.agentName}</h2>
                <StatusBadge tone={badge.tone} label={badge.label} />
              </div>
              <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays aria-hidden="true" className="size-4" />
                  {formatCadence(job)} ({job.timezone})
                </span>
                {job.lastRunAt !== undefined ? (
                  <span className="inline-flex items-center gap-1.5 tabular-nums">
                    <Clock aria-hidden="true" className="size-4" />
                    Last run {formatDateTime(job.lastRunAt)}
                  </span>
                ) : null}
                {job.state === "active" ? (
                  <span className="inline-flex items-center gap-1.5 tabular-nums">
                    <TimerReset aria-hidden="true" className="size-4" />
                    Next run {formatDateTime(job.nextRunAt)}
                  </span>
                ) : null}
              </p>
              <Outcome job={job} />
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button type="button" variant="accent" disabled={job.running} onClick={() => void runNow()}>
              <Play />
              Run now
            </Button>
            <Button type="button" variant="outline" onClick={() => void toggle()}>
              {job.state === "active" ? <Pause /> : <Play />}
              {job.state === "active" ? "Pause" : "Resume"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="More actions" />}>
                <Ellipsis />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => setEditing((open) => !open)}>
                  <CalendarDays />
                  Edit recurrence
                </DropdownMenuItem>
                {job.workspaceKey !== undefined && job.latestRunId !== undefined ? (
                  <DropdownMenuLinkItem render={<Link href={runLogsHref(instanceId, job.templateId, job.latestRunId)} />}>
                    <ScrollText />
                    View logs
                  </DropdownMenuLinkItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {editing ? <RecurrenceForm job={job} onDone={() => setEditing(false)} /> : null}
      </Card>
    </li>
  );
}

function RecurrenceForm({ job, onDone }: { job: JobRow; onDone: () => void }) {
  const setFrequency = useMutation(api.jobs.setFrequency);
  const [unit, setUnit] = useState<Unit>(job.unit);
  const [dayOfWeek, setDayOfWeek] = useState(job.dayOfWeek ?? 1);
  const [dayOfMonth, setDayOfMonth] = useState(job.dayOfMonth ?? 1);
  const [hour, setHour] = useState(job.hour);
  const [minute, setMinute] = useState(job.minute);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setError(null);
    const frequency =
      unit === "weekly"
        ? { unit, dayOfWeek, hour, minute }
        : unit === "monthly"
          ? { unit, dayOfMonth, hour, minute }
          : { unit, hour, minute };
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await setFrequency({ jobId: job._id as Id<"jobs">, frequency, timezone });
      onDone();
    } catch (err: unknown) {
      setError(extractConvexErrorMessage(err, "Failed to save the recurrence."));
    }
  }

  return (
    <div className="grid gap-3 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          Repeat
          <NativeSelect name="unit" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </NativeSelect>
        </label>
        {unit === "weekly" ? (
          <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
            Day of week
            <NativeSelect
              name="dayOfWeek"
              value={dayOfWeek}
              onChange={(e) => setDayOfWeek(Number(e.target.value))}
            >
              {WEEKDAYS.map((name, idx) => (
                <option key={name} value={idx}>
                  {name}
                </option>
              ))}
            </NativeSelect>
          </label>
        ) : null}
        {unit === "monthly" ? (
          <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
            Day of month
            <Input
              name="dayOfMonth"
              type="number"
              min={1}
              max={31}
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(Math.max(1, Math.min(31, Number(e.target.value))))}
              className="w-24"
            />
          </label>
        ) : null}
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          Hour
          <Input
            name="hour"
            type="number"
            min={0}
            max={23}
            value={hour}
            onChange={(e) => setHour(Math.max(0, Math.min(23, Number(e.target.value))))}
            className="w-20"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          Minute
          <Input
            name="minute"
            type="number"
            min={0}
            max={59}
            value={minute}
            onChange={(e) => setMinute(Math.max(0, Math.min(59, Number(e.target.value))))}
            className="w-20"
          />
        </label>
        <Button type="button" onClick={() => void save()}>
          Save
        </Button>
      </div>
      {error ? <p className="m-0 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
