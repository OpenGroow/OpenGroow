"use client";

import type { ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LogsStatePanel } from "@/src/components/workspace-logs-state-panel";
import type { JobSummary } from "@/src/components/workspace-logs.types";
import { Button } from "@/components/ui/button";

// The two Run parents a founder browses on the Agent Logs page: the Agent's
// Missions, and its generic or legacy Job. Both expand into their Runs;
// picking one loads that Run's transcript in the panel next door.

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="m-0 text-lg font-semibold text-foreground">
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
              <span className="">{run.status}</span>
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
      <p className="m-0 text-sm text-muted-foreground">
        Last outcome: {job.lastOutcome ?? "none yet"}
        {job.lastRunAt !== undefined ? ` · ${new Date(job.lastRunAt).toLocaleString()}` : ""}
      </p>
      {job.lastError ? (
        <p role="alert" className="m-0 break-words text-sm text-destructive">
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
                <span className="">{run.status}</span>
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
    <Card className="py-3">
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-2.5 px-4">
        <Button
          variant="ghost"
          type="button"
          onClick={onToggle}
          className="w-full justify-between"
        >
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <span className="text-xs text-muted-foreground">
            {expanded ? "Hide runs" : "Show runs"}
          </span>
        </Button>
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
    return <p className="m-0 text-sm text-muted-foreground">Loading runs…</p>;
  }
  if (runs.length === 0) {
    return <p className="m-0 text-sm text-muted-foreground">No Runs yet.</p>;
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
    <Button
      type="button"
      variant={selected ? "default" : "secondary"}
      onClick={onClick}
      className={cn(layout, "h-auto justify-start whitespace-normal py-2 text-left")}
    >
      {children}
    </Button>
  );
}
