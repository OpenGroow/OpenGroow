"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { useProjectManifests } from "@/src/hooks/use-project-manifests";
import { AutoPublishToggle, supportsAutoPublish, type AutoPublishControl } from "./auto-publish-toggle";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import { runLogsHref, runPromptHref } from "@/src/lib/instance-path";
import { blockedExternalResult } from "@/src/lib/mission-result";
import { Button } from "@/components/ui/button";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { missionStatus, runStatus } from "@/components/opengroow/mission-status";
import { Card } from "@/components/ui/card";
import { PublicationList } from "./publication-list";
import { MissionReviewContent } from "./mission-review-page";
import { titleCase } from "@/src/lib/mission-type";
import { Bot, Calendar, Code, Ellipsis, FileText, Layers, RefreshCw, Trash2, type LucideIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

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

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "runs", label: "Run History" },
] as const;

function MissionStatusBadge({ status }: { status: string }) {
  const { label, tone } = missionStatus(status);
  return <StatusBadge tone={tone} label={label} size="default" />;
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

/** One label / value line of the Mission details card, separated from the next by a rule. */
function DetailRow({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border pb-2 last:border-0 last:pb-0">
      <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
      <dt className="flex-1 text-muted-foreground">{label}</dt>
      <dd className="m-0 text-foreground">{children}</dd>
    </div>
  );
}

function RunRow({
  run,
  instanceId,
  templateId,
  missionLabel,
  missionNumber,
  hasWorkspace,
}: {
  run: Doc<"runs">;
  instanceId: string;
  templateId: string;
  /** The Mission type as a title (`Create Reel`). */
  missionLabel: string;
  missionNumber?: number;
  hasWorkspace: boolean;
}) {
  const summary = run.result?.summary ?? intermediateResultSummary(run.intermediateResult);
  const additionalDetails =
    run.result && "additionalDetails" in run.result
      ? run.result.additionalDetails
      : undefined;

  return (
    <div className="grid gap-3 rounded-2xl border border-border bg-card p-5" data-testid="run-row">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xl font-semibold text-foreground">
          {missionLabel}
          {missionNumber !== undefined && ` #${missionNumber}`}
        </span>
        <StatusBadge tone={runStatus(run.status).tone} label={runStatus(run.status).label} size="default" />
        {hasWorkspace && (
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            nativeButton={false}
            render={<Link href={runLogsHref(instanceId, templateId, run._id)} />}
          >
            <FileText />
            View logs
          </Button>
        )}
        {/* Every Run listed here is one of this Mission's, so `missionId` is
            always set; the check only narrows the optional/null field the `runs`
            table stores it in (a Run's other RunParent is a SourceJob). */}
        {hasWorkspace && run.missionId != null && (
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            nativeButton={false}
            render={<Link href={runPromptHref(instanceId, templateId, run._id, run.missionId)} />}
          >
            <Code />
            View prompt
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <Calendar aria-hidden="true" className="size-4" />
          Started {formatLocalTimestamp(run.createdAt)}
        </span>
        {run.completedAt !== undefined && (
          <span className="flex items-center gap-2">
            <Calendar aria-hidden="true" className="size-4" />
            Completed {formatLocalTimestamp(run.completedAt)}
          </span>
        )}
      </div>
      {summary && (
        <p className="m-0 text-base text-muted-foreground">{summary}</p>
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
  const [tab, setTab] = useState<"overview" | "runs">("overview");

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

  const manifest = manifests.find((m) => m.id === mission.templateId);
  const missionTypeEntry = manifest?.missionTypes?.find((t) => t.type === mission.type);
  const typeLabel = missionTypeEntry?.label ?? mission.type;
  const agentName = manifest?.name ?? mission.templateId;
  const declaresPublish = Boolean(missionTypeEntry?.publish);
  const title = titleCase(mission.type);

  const autoPublish: AutoPublishControl | undefined = autoPublishAllowed
    ? {
        checked: mission.autoPublish === true,
        editable: autoPublishEditable,
        onChange: (next: boolean) => void handleAutoPublishToggle(next),
        hint: autoPublishEditable
          ? undefined
          : "This Mission's Run has finished — auto-publish can no longer be changed.",
      }
    : undefined;

  const detailsCard = (
    <Card className="grid gap-4 p-6" data-testid="mission-details">
      <h2 className="m-0 flex items-center gap-2 text-lg font-semibold text-foreground">
        <Layers aria-hidden="true" className="size-5 text-muted-foreground" />
        Mission details
      </h2>
      {(mission.name ?? mission.summary) ? (
        <div className="grid gap-1">
          {mission.name && <p className="m-0 text-sm font-semibold text-foreground">{mission.name}</p>}
          {mission.summary && <p className="m-0 text-sm text-muted-foreground">{mission.summary}</p>}
        </div>
      ) : null}
      <dl className="m-0 grid gap-2 text-sm">
        <DetailRow icon={Layers} label="Type">{typeLabel}</DetailRow>
        <DetailRow icon={Bot} label="Agent">{agentName}</DetailRow>
        {mission.sourceObservationId !== undefined && (
          <DetailRow icon={Layers} label="Source">
            <Link
              href={`/projects/${encodeURIComponent(instanceId)}/sources/${encodeURIComponent(mission.sourceObservationId)}`}
              className={cn(badgeVariants({ variant: "default" }), "hover:bg-primary/25")}
              data-testid="from-observation-badge"
            >
              From Source
            </Link>
          </DetailRow>
        )}
        <DetailRow icon={Calendar} label="Created">{formatLocalTimestamp(mission.createdAt)}</DetailRow>
        <DetailRow icon={RefreshCw} label="Updated">{formatLocalTimestamp(mission.updatedAt)}</DetailRow>
      </dl>
      {/* Without a Publishing card (no `publish` declared), Auto-publish stays here. */}
      {autoPublish && !declaresPublish && (
        <AutoPublishToggle
          checked={autoPublish.checked}
          disabled={!autoPublish.editable}
          hint={autoPublish.hint}
          onChange={autoPublish.onChange}
        />
      )}
    </Card>
  );

  return (
    <div className="grid min-w-0 gap-6">
      <header className="grid gap-4">
        <Link
          href={`/projects/${encodeURIComponent(instanceId)}/missions`}
          className="text-xs font-semibold text-muted-foreground hover:text-primary"
        >
          ← Missions
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="m-0 text-3xl font-bold tracking-tight break-words text-foreground sm:text-4xl">
                {title}
              </h1>
              <MissionStatusBadge status={mission.status} />
            </div>
            <p className="m-0 text-base text-muted-foreground">
              {agentName}
              {mission.number !== undefined ? ` · #${mission.number}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {showRetry && (
              <Button
                variant="outline"
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
            {/* The "more actions" menu: Delete today, room for other actions later. */}
            {showDelete && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="outline" size="icon" aria-label="More actions" data-action="more" />}
                >
                  <Ellipsis />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    className="text-status-error"
                    data-delete-mission={missionId}
                    onClick={() => void handleDelete()}
                  >
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
        <div role="tablist" aria-label="Mission" className="flex gap-6 border-b border-border">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              data-testid={`mission-tab-${key}`}
              onClick={() => setTab(key)}
              className={cn(
                "-mb-px border-b-2 px-1 pb-3 text-base font-semibold transition-colors",
                tab === key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* Both panels stay mounted (the inactive one hidden): switching tabs must not reload the review. */}
      <div hidden={tab !== "overview"} className="grid min-w-0 gap-6">
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


          {!declaresPublish && <PublicationList missionId={missionId} title="Publications" />}

          <MissionReviewContent
            instanceId={instanceId}
            missionId={missionId}
            aside={detailsCard}
            autoPublish={declaresPublish ? autoPublish : undefined}
          />
      </div>
      <section hidden={tab !== "runs"} className="grid gap-4" aria-label="Run History">
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
                  missionLabel={titleCase(mission.type)}
                  missionNumber={mission.number}
                  hasWorkspace={projectAgent?.workspaceKey !== undefined}
                />
              ))}
            </div>
          )}
      </section>
    </div>
  );
}
