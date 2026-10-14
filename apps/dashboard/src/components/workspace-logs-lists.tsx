"use client";

import type { ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LogsStatePanel } from "@/src/components/workspace-logs-state-panel";
import type { JobSummary } from "@/src/components/workspace-logs.types";

// The two Run parents a founder browses on the Agent Logs page: the Agent's
// Missions, and its generic or legacy Job. Both expand into their Runs;
// picking one loads that Run's transcript in the panel next door.

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="m-0 text-[0.78rem] font-bold uppercase tracking-[0.16em] text-[var(--dashboard-ink-soft)]">
      {children}
    </h2>
  );
}

export function MissionList({
  missions,
  expandedMissionId,
  selectedRunId,
  onToggleMission,
  onSelectRun,
}: {
  missions: Doc<"missions">[] | undefined;
  expandedMissionId: Id<"missions"> | null;
  selectedRunId: Id<"runs"> | null;
  onToggleMission: (missionId: Id<"missions">) => void;
  onSelectRun: (runId: Id<"runs">) => void;
}) {
  if (missions === undefined) {
    return <LogsStatePanel title="Loading Missions" description="Fetching this Agent's Missions." />;
  }
  if (missions.length === 0) {
    return (
      <LogsStatePanel
        title="No Missions yet"
        description="This Agent hasn't been assigned a Mission yet — Missions will appear here once created."
      />
    );
  }

  return (
    <div className="grid gap-3 self-start">
      <SectionHeading>Missions</SectionHeading>
      {missions.map((mission) => (
        <MissionRow
          key={mission._id}
          mission={mission}
          expanded={expandedMissionId === mission._id}
          selectedRunId={selectedRunId}
          onToggle={() => onToggleMission(mission._id)}
          onSelectRun={onSelectRun}
        />
      ))}
    </div>
  );
}

function MissionRow({
  mission,
  expanded,
  selectedRunId,
  onToggle,
  onSelectRun,
}: {
  mission: Doc<"missions">;
  expanded: boolean;
  selectedRunId: Id<"runs"> | null;
  onToggle: () => void;
  onSelectRun: (runId: Id<"runs">) => void;
}) {
  const runs = useQuery(api.workspace_logs.listRunsForMission, expanded ? { missionId: mission._id } : "skip");

  return (
    <ParentCard
      title={mission.name ?? mission.summary ?? `Mission #${mission.number ?? ""}`}
      expanded={expanded}
      onToggle={onToggle}
    >
      {expanded ? (
        <RunList runs={runs}>
          {(run) => (
            <RunButton
              key={run._id}
              selected={run._id === selectedRunId}
              layout="flex items-center justify-between gap-3"
              onClick={() => onSelectRun(run._id)}
            >
              <span>{new Date(run.createdAt).toLocaleString()}</span>
              <span className="uppercase tracking-[0.08em]">{run.status}</span>
            </RunButton>
          )}
        </RunList>
      ) : null}
    </ParentCard>
  );
}

// The Agent's Jobs, next to its Missions: what they last did, then their Runs.
export function JobList({
  jobs,
  expandedJobId,
  selectedRunId,
  onToggleJob,
  onSelectRun,
}: {
  jobs: JobSummary[] | undefined;
  expandedJobId: Id<"jobs"> | null;
  selectedRunId: Id<"runs"> | null;
  onToggleJob: (jobId: Id<"jobs">) => void;
  onSelectRun: (runId: Id<"runs">) => void;
}) {
  // An Agent without jobs has nothing to show here.
  if (jobs === undefined || jobs.length === 0) return null;

  return (
    <div className="grid gap-3">
      <SectionHeading>Jobs</SectionHeading>
      {jobs.map((job) => (
        <JobRow
          key={job._id}
          job={job}
          expanded={expandedJobId === job._id}
          selectedRunId={selectedRunId}
          onToggle={() => onToggleJob(job._id)}
          onSelectRun={onSelectRun}
        />
      ))}
    </div>
  );
}

function JobRow({
  job,
  expanded,
  selectedRunId,
  onToggle,
  onSelectRun,
}: {
  job: JobSummary;
  expanded: boolean;
  selectedRunId: Id<"runs"> | null;
  onToggle: () => void;
  onSelectRun: (runId: Id<"runs">) => void;
}) {
  const runs = useQuery(api.workspace_logs.listRunsForJob, expanded ? { jobId: job._id } : "skip");

  return (
    <ParentCard title={`${job.agentName} job`} expanded={expanded} onToggle={onToggle}>
      {/* The job's last outcome stays readable while the card is collapsed —
          it is the first thing a founder debugging a job looks for. */}
      <p className="m-0 text-[0.82rem] text-[var(--dashboard-ink-muted)]">
        Last outcome: {job.lastOutcome ?? "none yet"}
        {job.lastRunAt !== undefined ? ` · ${new Date(job.lastRunAt).toLocaleString()}` : ""}
      </p>
      {job.lastError ? (
        <p role="alert" className="m-0 break-words text-[0.82rem] text-[var(--dashboard-tertiary)]">
          {job.lastError}
        </p>
      ) : null}
      {expanded ? (
        <RunList runs={runs}>
          {(run) => (
            <RunButton
              key={run._id}
              selected={run._id === selectedRunId}
              layout="grid grid-cols-[minmax(0,1fr)] gap-1"
              onClick={() => onSelectRun(run._id)}
            >
              <span className="flex items-center justify-between gap-3">
                <span>{new Date(run.createdAt).toLocaleString()}</span>
                <span className="uppercase tracking-[0.08em]">{run.status}</span>
              </span>
              {run.errorMessage ? <span className="break-words">{run.errorMessage}</span> : null}
            </RunButton>
          )}
        </RunList>
      ) : null}
    </ParentCard>
  );
}

/** One Run parent's card (a Mission or a Job): its name and a show/hide
 * toggle, over whatever the parent renders beneath. */
function ParentCard({
  title,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <Card className="rounded-[1.4rem] border-0 py-3 shadow-[inset_0_0_0_1px_rgba(0,38,27,0.08)]">
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-2.5 px-4">
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span className="text-[0.94rem] font-semibold text-[var(--dashboard-ink)]">{title}</span>
          <span className="text-[0.78rem] uppercase tracking-[0.1em] text-[var(--dashboard-ink-soft)]">
            {expanded ? "Hide runs" : "Show runs"}
          </span>
        </button>
        {children}
      </CardContent>
    </Card>
  );
}

/** The loading / empty / listed states an expanded Run list goes through,
 * shared by Missions and jobs. `children` renders one Run — the two differ
 * only in what they put inside the button. */
function RunList<Run>({
  runs,
  children,
}: {
  runs: Run[] | undefined;
  children: (run: Run) => ReactNode;
}) {
  if (runs === undefined) {
    return <p className="m-0 text-[0.82rem] text-[var(--dashboard-ink-muted)]">Loading runs…</p>;
  }
  if (runs.length === 0) {
    return <p className="m-0 text-[0.82rem] text-[var(--dashboard-ink-muted)]">No Runs yet.</p>;
  }
  return <div className="grid gap-2">{runs.map((run) => children(run))}</div>;
}

function RunButton({
  selected,
  layout,
  onClick,
  children,
}: {
  selected: boolean;
  layout: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        layout,
        "rounded-xl px-3 py-2 text-left text-[0.84rem]",
        selected
          ? "bg-[var(--dashboard-primary)] text-white"
          : "bg-[rgba(220,230,224,0.35)] text-[var(--dashboard-ink)]",
      )}
    >
      {children}
    </button>
  );
}
