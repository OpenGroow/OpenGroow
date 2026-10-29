"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { useProjectManifests } from "@/src/hooks/use-project-manifests";
import { AutoPublishToggle, supportsAutoPublish } from "./auto-publish-toggle";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import { runLogsHref, runPromptHref } from "@/src/lib/instance-path";
import { blockedExternalResult } from "@/src/lib/mission-result";
import { Button } from "@/components/ui/button";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { missionStatus, runStatus } from "@/components/opengroow/mission-status";
import { Card } from "@/components/ui/card";

type Props = {
  params: Promise<{ projectId: string; missionId: string }>;
};

export function MissionDetailPage({ params }: Props) {
  const { projectId, missionId } = use(params);
  return (
    <MissionDetailContent
      instanceId={decodeURIComponent(projectId)}
      missionId={decodeURIComponent(missionId)}
    />
  );
}

// Extract a human-readable message from a run/mission result that reported a
// failure. The specific error.message is preferred over the broader summary.
function resultFailureMessage(
  result: Doc<"runs">["result"]
): string | undefined {
  if (result?.status !== "failed") return undefined;
  return result.error.message || result.summary;
}

// First failure explanation found across a mission's runs: an infra failure's
// errorMessage, otherwise the detail from a run that reported a failed result.
function runsFailureMessage(runs: Doc<"runs">[]): string | undefined {
  return (
    runs.find((r) => r.status === "failed")?.errorMessage ??
    runs.map((r) => resultFailureMessage(r.result)).find((m) => m !== undefined)
  );
}

function formatLocalTimestamp(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function MissionStatusBadge({ status }: { status: string }) {
  const { label, tone } = missionStatus(status);
  return <StatusBadge tone={tone} label={label} />;
}

function hasReviewableArtifact(mission: Doc<"missions">): boolean {
  const result = mission.lastResult;
  // The `failed` run-result variant carries no artifact, so narrow before access.
  if (!result || !("artifact" in result)) return false;
  const artifact = result.artifact;
  if (!artifact) return false;
  // Strict contract (ADR-020 / #146): identity lives in artifact.external.id only.
  return typeof artifact.external?.id === "string";
}

/**
 * A "resumed" Run (ADR-026: Intermediate External Job) carries no RunResult —
 * `run.intermediateResult` is the raw `{ jobType, output }` (job resolved) or
 * `{ jobType, error, details }` (retryable failure) shape instead. Duck-typed
 * on purpose: the payload is Template-specific (`v.any()`), so this only
 * surfaces the common human-readable fields it might carry, generically
 * across every Template rather than assuming one job's shape.
 */
function intermediateResultSummary(intermediateResult: unknown): string | undefined {
  if (!intermediateResult || typeof intermediateResult !== "object") return undefined;
  const record = intermediateResult as Record<string, unknown>;
  if (typeof record.error === "string") return record.error;
  const output = record.output;
  if (output && typeof output === "object" && typeof (output as Record<string, unknown>).explanation === "string") {
    return (output as Record<string, unknown>).explanation as string;
  }
  return undefined;
}

function RunRow({
  run,
  instanceId,
  templateId,
  missionLabel,
  hasWorkspace,
}: {
  run: Doc<"runs">;
  instanceId: string;
  templateId: string;
  missionLabel: string;
  hasWorkspace: boolean;
}) {
  const summary = run.result?.summary ?? intermediateResultSummary(run.intermediateResult);
  const additionalDetails =
    run.result && "additionalDetails" in run.result
      ? run.result.additionalDetails
      : undefined;

  return (
    <div className="grid gap-1.5 rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-foreground">
          {missionLabel}
        </span>
        <StatusBadge tone={runStatus(run.status).tone} label={runStatus(run.status).label} />
        {hasWorkspace && (
          <Link
            href={runLogsHref(instanceId, templateId, run._id)}
            className="text-xs font-semibold text-primary underline underline-offset-2 hover:no-underline"
          >
            View logs
          </Link>
        )}
        {/* Every Run listed here is one of this Mission's, so `missionId` is
            always set; the check only narrows the optional/null field the `runs`
            table stores it in (a Run's other RunParent is a SourceJob). */}
        {hasWorkspace && run.missionId != null && (
          <Link
            href={runPromptHref(instanceId, templateId, run._id, run.missionId)}
            className="text-xs font-semibold text-primary underline underline-offset-2 hover:no-underline"
          >
            View prompt
          </Link>
        )}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-0.5 text-xs text-muted-foreground">
        <span>Started {formatLocalTimestamp(run.createdAt)}</span>
        {run.completedAt !== undefined && (
          <span>Completed {formatLocalTimestamp(run.completedAt)}</span>
        )}
      </div>
      {summary && (
        <p className="m-0 text-sm text-muted-foreground">{summary}</p>
      )}
      {run.errorMessage && !summary && (
        <p className="m-0 text-sm text-destructive">{run.errorMessage}</p>
      )}
      {additionalDetails !== undefined && (
        <details className="rounded-xl border border-border bg-muted px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
            Additional details
          </summary>
          <pre className="m-0 mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
            {JSON.stringify(additionalDetails, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

export function MissionDetailContent({
  instanceId,
  missionId,
}: {
  instanceId: string;
  missionId: string;
}) {
  const { manifests } = useProjectManifests(instanceId);
  const router = useRouter();
  const mission = useQuery(api.missions.get, { missionId: missionId as Id<"missions"> });
  const runs = useQuery(api.runs.listByMission, { missionId: missionId as Id<"missions"> });
  // Whether this Mission's own Template has a workspace — only then do the
  // Agent Logs/Prompt pages have something to show for each Run.
  const projectAgent = useQuery(
    api.project_agents.get,
    mission ? { instanceId: mission.instanceId, templateId: mission.templateId } : "skip",
  );
  const deleteMission = useMutation(api.missions.deleteMission);
  const retryMission = useMutation(api.missions.retryMission);
  const setAutoPublish = useMutation(api.missions.setAutoPublish);
  const cancelMission = useAction(api.missions_node.cancelMission);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  async function handleDelete(): Promise<void> {
    const confirmed = window.confirm("Permanently delete this mission and all its runs?");
    if (!confirmed) return;
    try {
      await deleteMission({ missionId: missionId as Id<"missions"> });
      router.push(`/projects/${encodeURIComponent(instanceId)}/missions`);
    } catch (error: unknown) {
      window.alert(extractConvexErrorMessage(error, "Failed to delete mission"));
    }
  }

  async function handleStop(): Promise<void> {
    const confirmed = window.confirm("Stop this mission? The running agent process will be killed.");
    if (!confirmed) return;
    setIsStopping(true);
    try {
      await cancelMission({ missionId: missionId as Id<"missions"> });
    } catch (error: unknown) {
      window.alert(extractConvexErrorMessage(error, "Failed to stop mission"));
    } finally {
      setIsStopping(false);
    }
  }

  async function handleAutoPublishToggle(next: boolean): Promise<void> {
    try {
      await setAutoPublish({ missionId: missionId as Id<"missions">, autoPublish: next });
    } catch (error: unknown) {
      window.alert(extractConvexErrorMessage(error, "Failed to update auto-publish"));
    }
  }

  if (mission === null) {
    return (
      <div className="grid gap-8">
        <p className="text-sm text-muted-foreground">Mission not found.</p>
      </div>
    );
  }

  if (mission === undefined || runs === undefined) {
    return (
      <div className="grid gap-8">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const sortedRuns = [...runs].sort((a, b) => b.createdAt - a.createdAt);

  // For failed missions, find the most informative explanation. Failures arrive
  // two ways: infra/dispatch errors set `errorMessage` (and run.status "failed"),
  // while an agent that runs to completion but reports a failure records its detail
  // in `result` (status "failed") with run.status "completed". Check both, then fall
  // back to a generic message so the "What happened" section is always shown.
  const failureError: string | undefined =
    mission.status !== "failed"
      ? undefined
      : (mission.errorMessage ??
          resultFailureMessage(mission.lastResult) ??
          runsFailureMessage(sortedRuns) ??
          "Failed; no details recorded");

  const showReview =
    hasReviewableArtifact(mission) &&
    (mission.status === "to_validate" || mission.status === "approved");
  const showView = hasReviewableArtifact(mission);
  const showDelete = mission.status !== "doing";
  const showStop = mission.status === "doing";
  const showRetry = mission.status === "failed" || mission.status === "blocked";
  const blocked = blockedExternalResult(mission);
  const mostRecentRun = sortedRuns[0];

  const autoPublishAllowed = supportsAutoPublish(manifests, mission.templateId, mission.type);
  const autoPublishEditable = mission.status === "todo" || mission.status === "doing";

  async function handleRetry(): Promise<void> {
    if (!mostRecentRun) return;
    setIsRetrying(true);
    try {
      await retryMission({
        missionId: missionId as Id<"missions">,
        sourceRunId: mostRecentRun._id,
      });
    } catch (error: unknown) {
      window.alert(extractConvexErrorMessage(error, "Failed to retry mission"));
    } finally {
      setIsRetrying(false);
    }
  }

  return (
    <div className="grid gap-8">
      <header className="grid gap-1">
        <div className="flex items-center justify-between gap-4">
          <Link
            href={`/projects/${encodeURIComponent(instanceId)}/missions`}
            className="text-xs font-semibold text-muted-foreground hover:text-primary"
          >
            ← Missions
          </Link>
          <div className="flex items-center gap-2">
            {showReview && (
              <Link
                href={`/projects/${encodeURIComponent(instanceId)}/missions/${encodeURIComponent(missionId)}/review`}
                className="inline-flex min-h-8 items-center justify-center rounded-xl border border-border bg-primary/15 px-3 py-1 text-xs font-semibold text-primary transition hover:border-input"
              >
                {mission.status === "approved" ? "Publish" : "Review"}
              </Link>
            )}
            {showView && (
              <Link
                href={`/projects/${encodeURIComponent(instanceId)}/missions/${encodeURIComponent(missionId)}/view`}
                className="inline-flex min-h-8 items-center justify-center rounded-xl border border-border bg-card px-3 py-1 text-xs font-semibold text-foreground transition hover:border-input"
              >
                View
              </Link>
            )}
            {showRetry && (
              <Button
                variant="secondary"
                size="sm"
                type="button"
                aria-label="Retry mission"
                disabled={isRetrying}
                onClick={() => void handleRetry()}
              >
                {isRetrying ? "Retrying…" : "Retry"}
              </Button>
            )}
            {showStop && (
              <Button
                variant="destructive"
                size="sm"
                type="button"
                aria-label="Stop mission"
                data-stop-mission={missionId}
                disabled={isStopping}
                onClick={() => void handleStop()}
              >
                {isStopping ? "Stopping…" : "Stop"}
              </Button>
            )}
            {showDelete && (
              <Button
                variant="destructive"
                size="sm"
                type="button"
                aria-label="Delete mission"
                data-delete-mission={missionId}
                onClick={() => void handleDelete()}
              >
                Delete
              </Button>
            )}
          </div>
        </div>
        <h1 className="m-0 text-3xl font-bold tracking-tight break-words text-foreground sm:text-4xl">
          Mission Detail
        </h1>
      </header>

      {/* Mission Identity */}
      <Card className="grid gap-4 p-6">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-base font-semibold text-foreground">
            {mission.type}
            {mission.number !== undefined ? ` #${mission.number}` : ""}
          </span>
          <MissionStatusBadge status={mission.status} />
          {mission.sourceObservationId !== undefined && (
            <Link
              href={`/projects/${encodeURIComponent(instanceId)}/sources/${encodeURIComponent(mission.sourceObservationId)}`}
              className={cn(badgeVariants({ variant: "default" }), "hover:bg-primary/25")}
              data-testid="from-observation-badge"
            >
              From Source
            </Link>
          )}
        </div>

        {(mission.name ?? mission.summary) ? (
          <div className="grid gap-1">
            {mission.name && (
              <p className="m-0 text-sm font-semibold text-foreground">
                {mission.name}
              </p>
            )}
            {mission.summary && (
              <p className="m-0 text-sm text-muted-foreground">
                {mission.summary}
              </p>
            )}
          </div>
        ) : null}

        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="font-semibold text-muted-foreground">Created</dt>
          <dd className="text-foreground">{formatLocalTimestamp(mission.createdAt)}</dd>
          <dt className="font-semibold text-muted-foreground">Updated</dt>
          <dd className="text-foreground">{formatLocalTimestamp(mission.updatedAt)}</dd>
        </dl>

        {autoPublishAllowed && (
          <AutoPublishToggle
            checked={mission.autoPublish === true}
            disabled={!autoPublishEditable}
            hint={
              autoPublishEditable
                ? undefined
                : "This Mission's Run has finished — auto-publish can no longer be changed."
            }
            onChange={(next) => void handleAutoPublishToggle(next)}
          />
        )}
      </Card>

      {/* What happened — only for failed missions */}
      {failureError !== undefined && (
        <section className="grid gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-6">
          <h2 className="m-0 text-sm font-semibold text-destructive">
            What happened
          </h2>
          <p className="m-0 text-sm text-destructive">{failureError}</p>
        </section>
      )}

      {/* Blocked — a Template-declared human-action blocker (issue #323). */}
      {blocked !== undefined && (
        <section className="grid gap-3 rounded-xl border border-status-warning/30 bg-status-warning/10 p-6">
          <h2 className="m-0 text-sm font-semibold text-status-warning">
            Blocked
          </h2>
          <p className="m-0 text-sm text-status-warning">
            {blocked.message}{" "}
            {blocked.resolution?.kind === "link" && (
              <a href={blocked.resolution.url} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
                Open resolution link
              </a>
            )}
            {blocked.resolution?.kind === "execution_device" && (
              <span className="font-semibold">Resolve on the execution device.</span>
            )}
          </p>
        </section>
      )}

      {/* Run History */}
      <section className="grid gap-4">
        <h2 className="m-0 text-lg font-semibold text-foreground">
          Run History
        </h2>
        {sortedRuns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet</p>
        ) : (
          <div className="grid gap-3">
            {sortedRuns.map((run) => (
              <RunRow
                key={run._id}
                run={run}
                instanceId={instanceId}
                templateId={mission.templateId}
                missionLabel={`${mission.type}${mission.number !== undefined ? ` #${mission.number}` : ""}`}
                hasWorkspace={projectAgent?.workspaceKey !== undefined}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
