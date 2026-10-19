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
import { StatusBadge } from "@/components/opengroow/status-badge";
import { Card } from "@/components/ui/card";

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

export function InstanceJobsContent({ instanceId }: { instanceId: string }) {
  const jobs = useQuery(api.jobs.listByInstance, { instanceId }) as JobRow[] | undefined;

  return (
    <div className="grid gap-8">
      <PageHeader title="Jobs" description="Executions, their logs and retries." />

      <section className="grid gap-5">
        {jobs === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
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
    return <StatusBadge tone="neutral" label="Paused" />;
  }
  return job.running ? (
    <StatusBadge tone="progress" label="Running" />
  ) : (
    <StatusBadge tone="active" label="Active" />
  );
}

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
        <p className="m-0 text-sm font-semibold text-destructive">Last outcome: Failed</p>
        {job.lastError ? (
          <p role="alert" className="m-0 break-words text-sm text-destructive">
            {job.lastError}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="grid gap-1">
      <p className="m-0 text-sm text-primary">Last outcome: Succeeded</p>
      {job.lastSummary ? <p className="m-0 text-sm text-muted-foreground">{job.lastSummary}</p> : null}
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
    <li>
      <Card className="gap-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="m-0 text-lg font-semibold text-foreground">{job.agentName}</h2>
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
      <p className="m-0 text-sm text-muted-foreground">
        {formatCadence(job)} ({job.timezone}) ·{" "}
        {job.state === "paused" ? "Paused" : `Next run ${formatDateTime(job.nextRunAt)}`}
        {job.lastRunAt !== undefined ? ` · Last run ${formatDateTime(job.lastRunAt)}` : ""}
      </p>
      <Outcome job={job} />
      {job.workspaceKey !== undefined && job.latestRunId !== undefined ? (
        <Link
          href={runLogsHref(instanceId, job.templateId, job.latestRunId)}
          className="w-fit text-sm font-semibold text-primary underline underline-offset-2 hover:no-underline"
        >
          View logs
        </Link>
      ) : null}
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
