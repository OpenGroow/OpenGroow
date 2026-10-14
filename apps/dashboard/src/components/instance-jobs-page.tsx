"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import { runLogsHref } from "@/src/lib/instance-path";
import { formatCadence, WEEKDAYS } from "@/src/components/instance-schedules-page";

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
  "type" | "state" | "unit" | "dayOfWeek" | "dayOfMonth" | "hour" | "minute" | "timezone" | "nextRunAt" | "lastRunAt" | "lastOutcome" | "lastSummary" | "lastError"
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

const FIELD_CLASS =
  "rounded-xl border border-[rgba(0,38,27,0.12)] bg-white px-3 py-2 text-[0.88rem] text-[var(--dashboard-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)]";

export function InstanceJobsContent({ instanceId }: { instanceId: string }) {
  const jobs = useQuery(api.jobs.listByInstance, { instanceId }) as JobRow[] | undefined;

  return (
    <div className="grid gap-8">
      <header className="grid gap-1">
        <span className="text-[0.75rem] font-bold uppercase tracking-[0.18em] text-[var(--dashboard-ink-soft)]">
          Project
        </span>
        <h1 className="m-0 text-[clamp(1.6rem,3vw,2.5rem)] font-extrabold leading-[0.98] tracking-[-0.04em] text-[var(--dashboard-ink)]">
          Jobs
        </h1>
      </header>

      <section className="grid gap-5">
        {jobs === undefined ? (
          <p className="text-[0.92rem] text-[var(--dashboard-ink-muted)]">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="text-[0.92rem] text-[var(--dashboard-ink-muted)]">
            No jobs yet. Jobs appear here when an Agent with scheduled capabilities is activated.
          </p>
        ) : (
          <ul className="grid gap-3">
            {jobs.map((job) => (
              <JobRowItem key={job._id} job={job} instanceId={instanceId} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatePill({ job }: { job: JobRow }) {
  if (job.state === "paused") {
    return <StatusPill label="Paused" className="bg-[rgba(0,38,27,0.06)] text-[var(--dashboard-ink-muted)]" />;
  }
  return job.running ? (
    <StatusPill label="Running" className="bg-[rgba(220,230,224,0.7)] text-[var(--dashboard-ink-soft)]" />
  ) : (
    <StatusPill label="Active" className="bg-[rgba(188,237,215,0.7)] text-[var(--dashboard-primary)]" />
  );
}

// `skipped` is not an error: the previous execution was still running.
function Outcome({ job }: { job: JobRow }) {
  if (job.lastOutcome === undefined) {
    return <p className="m-0 text-[0.82rem] text-[var(--dashboard-ink-muted)]">Last outcome: none yet</p>;
  }
  if (job.lastOutcome === "skipped") {
    return (
      <p className="m-0 text-[0.82rem] text-[var(--dashboard-ink-muted)]">
        Last outcome: Skipped — the previous execution was still running.
      </p>
    );
  }
  if (job.lastOutcome === "failed") {
    return (
      <div className="grid gap-1">
        <p className="m-0 text-[0.82rem] font-semibold text-[var(--dashboard-tertiary)]">Last outcome: Failed</p>
        {job.lastError ? (
          <p role="alert" className="m-0 break-words text-[0.82rem] text-[var(--dashboard-tertiary)]">
            {job.lastError}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="grid gap-1">
      <p className="m-0 text-[0.82rem] text-[var(--dashboard-primary)]">Last outcome: Succeeded</p>
      {job.lastSummary ? <p className="m-0 text-[0.82rem] text-[var(--dashboard-ink-muted)]">{job.lastSummary}</p> : null}
    </div>
  );
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

  return (
    <li className="grid gap-2 rounded-2xl border border-[rgba(0,38,27,0.08)] bg-[#f8f9f7] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="m-0 text-[1rem] font-bold text-[var(--dashboard-ink)]">{job.agentName}</h2>
          <StatePill job={job} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={job.running} onClick={() => void runNow()}>
            Run Now
          </Button>
          <Button type="button" variant="outline" onClick={() => setEditing((open) => !open)}>
            Edit recurrence
          </Button>
          <Button type="button" variant="outline" onClick={() => void toggle()}>
            {job.state === "active" ? "Pause" : "Resume"}
          </Button>
        </div>
      </div>
      <p className="m-0 text-[0.82rem] text-[var(--dashboard-ink-muted)]">
        {formatCadence(job)} ({job.timezone}) ·{" "}
        {job.state === "paused" ? "Paused" : `Next run ${formatDateTime(job.nextRunAt)}`}
        {job.lastRunAt !== undefined ? ` · Last run ${formatDateTime(job.lastRunAt)}` : ""}
      </p>
      <Outcome job={job} />
      {job.workspaceKey !== undefined && job.latestRunId !== undefined ? (
        <Link
          href={runLogsHref(instanceId, job.templateId, job.latestRunId)}
          className="w-fit text-[0.82rem] font-semibold text-[var(--dashboard-primary)] underline underline-offset-2 hover:no-underline"
        >
          View logs
        </Link>
      ) : null}
      {editing ? <RecurrenceForm job={job} onDone={() => setEditing(false)} /> : null}
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
    <div className="grid gap-3 rounded-xl border border-[rgba(0,38,27,0.10)] bg-white p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-[0.78rem] font-semibold text-[var(--dashboard-ink-soft)]">
          Repeat
          <select name="unit" value={unit} onChange={(e) => setUnit(e.target.value as Unit)} className={FIELD_CLASS}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        {unit === "weekly" ? (
          <label className="grid gap-1 text-[0.78rem] font-semibold text-[var(--dashboard-ink-soft)]">
            Day of week
            <select
              name="dayOfWeek"
              value={dayOfWeek}
              onChange={(e) => setDayOfWeek(Number(e.target.value))}
              className={FIELD_CLASS}
            >
              {WEEKDAYS.map((name, idx) => (
                <option key={name} value={idx}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {unit === "monthly" ? (
          <label className="grid gap-1 text-[0.78rem] font-semibold text-[var(--dashboard-ink-soft)]">
            Day of month
            <input
              name="dayOfMonth"
              type="number"
              min={1}
              max={31}
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(Math.max(1, Math.min(31, Number(e.target.value))))}
              className={`${FIELD_CLASS} w-24`}
            />
          </label>
        ) : null}
        <label className="grid gap-1 text-[0.78rem] font-semibold text-[var(--dashboard-ink-soft)]">
          Hour
          <input
            name="hour"
            type="number"
            min={0}
            max={23}
            value={hour}
            onChange={(e) => setHour(Math.max(0, Math.min(23, Number(e.target.value))))}
            className={`${FIELD_CLASS} w-20`}
          />
        </label>
        <label className="grid gap-1 text-[0.78rem] font-semibold text-[var(--dashboard-ink-soft)]">
          Minute
          <input
            name="minute"
            type="number"
            min={0}
            max={59}
            value={minute}
            onChange={(e) => setMinute(Math.max(0, Math.min(59, Number(e.target.value))))}
            className={`${FIELD_CLASS} w-20`}
          />
        </label>
        <Button type="button" onClick={() => void save()}>
          Save
        </Button>
      </div>
      {error ? <p className="m-0 text-[0.82rem] text-red-700">{error}</p> : null}
    </div>
  );
}
