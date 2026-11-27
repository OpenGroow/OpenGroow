"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import { runLogsHref, runTraceHref } from "@/src/lib/instance-path";
import { formatCadence, WEEKDAYS } from "@/src/components/instance-schedules-page";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { analysisDaysOf, isValidAnalysisDays, MAX_ANALYSIS_DAYS, MIN_ANALYSIS_DAYS } from "@opengroow/protocol/strategic-review-period";
import {
  MAX_PLANNING_DAYS,
  MIN_PLANNING_DAYS,
  planningDaysOf,
  productionTargetsOf,
  validateContentPlanningConfig,
  type ProductionTarget,
} from "@opengroow/protocol/content-planning-config";
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
  Activity,
  Ellipsis,
  Pause,
  Play,
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
  config?: unknown;
  lastSummary?: string;
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
      <PageHeader title="Jobs" description="Background work your agents run on a recurrence: ingestion, scoring and ranking. Track, pause or run now." />

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
};
const FALLBACK_ICON = { icon: Workflow, tone: "bg-tone-slate-soft text-tone-slate" };

// `skipped` is not an error: the previous execution was still running.
function Outcome({ job }: { job: JobRow }) {
  // The status badge already says "Running": the last outcome is about an earlier execution.
  if (job.running) return null;
  if (job.lastOutcome === undefined) {
    return <p className="m-0 text-sm text-muted-foreground">Last outcome: none yet</p>;
  }
  // Content Planning skips before any Run exists: its summary says why (ADR-086).
  if (job.lastOutcome === "skipped" && job.type === "content_planning" && job.lastSummary) {
    return <p className="m-0 text-sm text-muted-foreground">Last outcome: Skipped — {job.lastSummary}</p>;
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
  const [editingPeriod, setEditingPeriod] = useState(false);
  const [editingTargets, setEditingTargets] = useState(false);
  const planning = job.type === "content_planning";
  const analysisDays = job.type === "strategic_review" ? analysisDaysOf(job.config) : undefined;

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
              {analysisDays !== undefined ? (
                <p className="m-0 text-sm text-muted-foreground">
                  Analyzes the last {analysisDays} {analysisDays === 1 ? "day" : "days"}
                </p>
              ) : null}
              {planning ? <PlanningSummary config={job.config} /> : null}
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
                {analysisDays !== undefined ? (
                  <DropdownMenuItem onClick={() => setEditingPeriod((open) => !open)}>
                    <CalendarDays />
                    Edit analysis period
                  </DropdownMenuItem>
                ) : null}
                {planning ? (
                  <DropdownMenuItem onClick={() => setEditingTargets((open) => !open)}>
                    <Layers />
                    Edit planning targets
                  </DropdownMenuItem>
                ) : null}
                {job.workspaceKey !== undefined && job.latestRunId !== undefined ? (
                  <DropdownMenuLinkItem render={<Link href={runLogsHref(instanceId, job.templateId, job.latestRunId)} />}>
                    <ScrollText />
                    View logs
                  </DropdownMenuLinkItem>
                ) : null}
                {job.workspaceKey !== undefined && job.latestRunId !== undefined ? (
                  <DropdownMenuLinkItem render={<Link href={runTraceHref(instanceId, job.templateId, job.latestRunId)} />}>
                    <Activity />
                    View trace
                  </DropdownMenuLinkItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {editing ? <RecurrenceForm job={job} onDone={() => setEditing(false)} /> : null}
        {editingTargets && planning ? (
          <PlanningTargetsForm job={job} instanceId={instanceId} onDone={() => setEditingTargets(false)} />
        ) : null}
        {editingPeriod && analysisDays !== undefined ? (
          <AnalysisPeriodForm jobId={job._id} current={analysisDays} onDone={() => setEditingPeriod(false)} />
        ) : null}
      </Card>
    </li>
  );
}

function PlanningSummary({ config }: { config: unknown }) {
  const days = planningDaysOf(config);
  const targets = productionTargetsOf(config);
  return (
    <p className="m-0 text-sm text-muted-foreground">
      Plans the next {days} {days === 1 ? "day" : "days"}
      {targets.length === 0 ? " · No production targets" : ` · ${targets.map((t) => `${t.quantity} ${t.contentType}`).join(", ")}`}
    </p>
  );
}

type TargetDraft = { enabled: boolean; quantity: string; publishTargets: string[] };

// The planning horizon and the production targets per format (ADR-086). The formats come from the
// Project's active Agents and the validator is the one the server applies on save.
function PlanningTargetsForm({ job, instanceId, onDone }: { job: JobRow; instanceId: string; onDone: () => void }) {
  const options = useQuery(api.content_planning_jobs.options, { instanceId });
  const setConfig = useMutation(api.content_planning_jobs.setConfig);
  const [days, setDays] = useState(String(planningDaysOf(job.config)));
  const [drafts, setDrafts] = useState<Record<string, TargetDraft>>(() =>
    Object.fromEntries(
      productionTargetsOf(job.config).map((t) => [t.contentType, { enabled: true, quantity: String(t.quantity), publishTargets: t.publishTargets }]),
    ),
  );
  const [errors, setErrors] = useState<string[]>([]);

  if (options === undefined) return <p className="m-0 text-sm text-muted-foreground">Loading planning options…</p>;

  const draftOf = (contentType: string): TargetDraft => drafts[contentType] ?? { enabled: false, quantity: "1", publishTargets: [] };
  const update = (contentType: string, patch: Partial<TargetDraft>) => setDrafts((all) => ({ ...all, [contentType]: { ...draftOf(contentType), ...patch } }));

  async function save(): Promise<void> {
    if (!options) return;
    const productionTargets: ProductionTarget[] = options.formats
      .filter((contentType) => draftOf(contentType).enabled)
      .map((contentType) => ({
        contentType,
        quantity: draftOf(contentType).quantity.trim() === "" ? NaN : Number(draftOf(contentType).quantity),
        publishTargets: draftOf(contentType).publishTargets.filter((key) => options.publishTargets.includes(key)),
      }));
    const planningDays = days.trim() === "" ? NaN : Number(days);
    const checked = validateContentPlanningConfig({ planningDays, productionTargets }, options);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors([]);
    try {
      await setConfig({ jobId: job._id as Id<"jobs">, ...checked.value });
      onDone();
    } catch (err: unknown) {
      setErrors([extractConvexErrorMessage(err, "Failed to save the planning targets.")]);
    }
  }

  return (
    <div className="grid gap-3 rounded-xl border border-border bg-card p-3">
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        Planning horizon (days)
        <Input
          name="planningDays"
          type="number"
          min={MIN_PLANNING_DAYS}
          max={MAX_PLANNING_DAYS}
          step={1}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          className="w-28"
        />
      </label>
      {options.formats.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">No active Agent produces content to publish yet.</p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {options.formats.map((contentType) => {
            const draft = draftOf(contentType);
            return (
              <li key={contentType} className="grid gap-2 rounded-lg border border-border p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox data-testid={`format-${contentType}`} checked={draft.enabled} onCheckedChange={(checked) => update(contentType, { enabled: checked })} />
                  {contentType}
                </label>
                {draft.enabled ? (
                  <div className="flex flex-wrap items-end gap-4">
                    <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
                      Quantity
                      <Input
                        name={`quantity-${contentType}`}
                        type="number"
                        min={1}
                        step={1}
                        value={draft.quantity}
                        onChange={(e) => update(contentType, { quantity: e.target.value })}
                        className="w-24"
                      />
                    </label>
                    <fieldset className="m-0 flex flex-wrap gap-3 border-0 p-0">
                      <legend className="text-xs font-semibold text-muted-foreground">Publish targets</legend>
                      {options.publishTargets.length === 0 ? (
                        <span className="text-sm text-muted-foreground">Add a Publisher channel first.</span>
                      ) : (
                        options.publishTargets.map((key) => (
                          <label key={key} className="flex items-center gap-1.5 text-sm">
                            <Checkbox
                              data-testid={`target-${contentType}-${key}`}
                              checked={draft.publishTargets.includes(key)}
                              onCheckedChange={(checked) =>
                                update(contentType, {
                                  publishTargets: checked ? [...draft.publishTargets, key] : draft.publishTargets.filter((k) => k !== key),
                                })
                              }
                            />
                            {key}
                          </label>
                        ))
                      )}
                    </fieldset>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <Button type="button" onClick={() => void save()}>
          Save
        </Button>
      </div>
      {errors.length > 0 ? (
        <div role="alert" className="grid gap-1 text-sm text-destructive">
          {errors.map((message) => (
            <p key={message} className="m-0">
              {message}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const PERIOD_ERROR = `Enter a whole number of days between ${MIN_ANALYSIS_DAYS} and ${MAX_ANALYSIS_DAYS}.`;

// The period is the Job's own setting (ADR-085), independent of its recurrence.
function AnalysisPeriodForm({ jobId, current, onDone }: { jobId: string; current: number; onDone: () => void }) {
  const setAnalysisDays = useMutation(api.strategic_review_jobs.setAnalysisDays);
  const [value, setValue] = useState(String(current));
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setError(null);
    const days = value.trim() === "" ? NaN : Number(value);
    if (!isValidAnalysisDays(days)) {
      setError(PERIOD_ERROR);
      return;
    }
    try {
      await setAnalysisDays({ jobId: jobId as Id<"jobs">, analysisDays: days });
      onDone();
    } catch (err: unknown) {
      setError(extractConvexErrorMessage(err, "Failed to save the analysis period."));
    }
  }

  return (
    <div className="grid gap-3 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          Analysis period (days)
          <Input
            name="analysisDays"
            type="number"
            min={MIN_ANALYSIS_DAYS}
            max={MAX_ANALYSIS_DAYS}
            step={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-28"
          />
        </label>
        <Button type="button" onClick={() => void save()}>
          Save
        </Button>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
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
