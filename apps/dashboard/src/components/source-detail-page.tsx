"use client";

import Link from "next/link";
import { use } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CalendarDays, Link2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import { sourceScore } from "@/src/lib/source-score";
import { useProduceSource } from "@/src/components/source-route-target";
import { FormatBadge, SourceThumbnail, useSourcePlatforms, useThumbnailRequests } from "@/src/components/source-visuals";
import { runLogsHref } from "@/src/lib/instance-path";
import { SchemaFields, SchemaValue, type JsonSchema } from "@/src/components/schema-value";
import { SOURCE_PIPELINE_STAGES, deriveSourcePipelineState, type SourcePipelineState } from "@/src/lib/source-pipeline";
import { formatSourceDate, SourceStatusPill } from "@/src/components/source-status-pill";
import { Card } from "@/components/ui/card";
import { isWebUrl } from "@/src/lib/web-url";

export { deriveSourcePipelineState } from "@/src/lib/source-pipeline";

type Props = {
  params: Promise<{ projectId: string; sourceId: string }>;
};

export function SourceDetailPage({ params }: Props) {
  const { projectId, sourceId } = use(params);
  return (
    <SourceDetailContent instanceId={decodeURIComponent(projectId)} sourceId={decodeURIComponent(sourceId)} />
  );
}

export function SourceDetailContent({ instanceId, sourceId }: { instanceId: string; sourceId: string }) {
  const result = useQuery(api.sources.get, { sourceId: sourceId as Id<"sources"> });
  const retry = useMutation(api.sources.retry);
  const { produce, busy: producing } = useProduceSource(sourceId);
  const visual = result ? { ...result.source, thumbnailUrl: result.thumbnailUrl } : undefined;
  useThumbnailRequests(instanceId, visual ? [visual] : []);
  const platformOf = useSourcePlatforms(instanceId);

  if (result === undefined) return <Message>Loading…</Message>;
  if (result === null) return <Message>Source not found.</Message>;

  const { source, analysisSchema, workspaceKey } = result;
  const marketing = source.marketing as Record<string, unknown>;
  const scoring = (source.scoring ?? {}) as Record<string, unknown>;
  const analysis = (source.analysis ?? {}) as Record<string, unknown>;
  const pipeline = deriveSourcePipelineState(source);

  const score = sourceScore(source.scoring);
  const origin = String(source.origin);

  async function handleRetry(): Promise<void> {
    try {
      await retry({ sourceId: sourceId as Id<"sources"> });
    } catch (error: unknown) {
      window.alert(extractConvexErrorMessage(error, "Failed to retry the Source."));
    }
  }

  return (
    <div className="grid max-w-[920px] gap-8" data-testid="source-detail">
      <header className="grid gap-5">
        <Link
          href={`/projects/${encodeURIComponent(instanceId)}/sources`}
          className="w-fit text-xs font-semibold text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          ← Sources
        </Link>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <SourceThumbnail source={visual!} className="h-36 w-28" />
          <div className="grid min-w-0 flex-1 gap-3">
            <h1 className="m-0 text-xl font-semibold tracking-tight break-words text-foreground sm:text-2xl">
              {source.marketing.summary ?? source.origin}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <SourceStatusPill status={source.status} />
              <FormatBadge source={source} platform={platformOf(visual!)} />
              {score !== undefined ? (
                <Badge variant="outline" className="gap-2 tabular-nums" data-testid="source-score">
                  <Sparkles aria-hidden="true" className="size-3.5" />
                  Score {score}
                </Badge>
              ) : null}
              {source.status === "failed" ? (
                <Button type="button" variant="outline" size="sm" onClick={() => void handleRetry()}>
                  Retry
                </Button>
              ) : null}
            </div>
          </div>
          {/* Only for a Source that is scored and not picked yet: the ones the Scored tab lists.
              Its own column, so the thumbnail, the title and the button start on the same line. */}
          {pipeline.kind === "stage" && pipeline.current === "Scored" ? (
            <Button type="button" variant="accent" className="h-10 shrink-0 sm:self-start" disabled={producing} onClick={() => void produce()}>
              <Sparkles />
              Produce
            </Button>
          ) : null}
        </div>
        {source.status === "processing" && source.retryRequested ? (
          <p className="m-0 text-sm text-muted-foreground">
            Retry requested. It is picked up at the next run of the Agent&apos;s job.
          </p>
        ) : null}
        <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays aria-hidden="true" className="size-4" />
            Observed {formatSourceDate(source.capturedAt)}
          </span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Link2 aria-hidden="true" className="size-4 shrink-0" />
            {isWebUrl(origin) ? (
              <a href={origin} target="_blank" rel="noreferrer" title={origin} className="hover:underline">
                Link
              </a>
            ) : (
              <span className="truncate">{origin}</span>
            )}
          </span>
          {source.runId && workspaceKey ? (
            <>
              <span aria-hidden="true">·</span>
              <Link
                data-testid="source-run-link"
                href={runLogsHref(instanceId, source.templateId, source.runId)}
                className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                View Run
              </Link>
            </>
          ) : null}
        </p>
        {source.productionMissionId ? (
          <Link
            data-testid="source-production-mission-link"
            href={`/projects/${encodeURIComponent(instanceId)}/missions/${encodeURIComponent(source.productionMissionId)}`}
            className="w-fit font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            View production Mission
          </Link>
        ) : null}
      </header>

      <SourcePipelineStepper state={pipeline} />

      <Section id="teaches" title="What this teaches">
        <SchemaFields value={marketing} />
      </Section>

      {Object.keys(scoring).length > 0 ? (
        <details
          data-testid="scoring-details"
          className="rounded-xl border border-border bg-background p-6"
        >
          <summary className="cursor-pointer text-base font-semibold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            Scoring details
          </summary>
          <div className="mt-4">
            <SchemaFields value={scoring} />
          </div>
        </details>
      ) : null}

      <Section id="analysis" title="Source analysis">
        <SchemaFields value={analysis} schema={analysisSchema as JsonSchema | null} />
      </Section>

      {source.raw ? (
        <details className="rounded-xl border border-border bg-background p-6">
          <summary className="cursor-pointer text-base font-semibold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            Raw
          </summary>
          <pre className="mt-4 max-h-[32rem] overflow-auto whitespace-pre-wrap break-all text-xs text-foreground">
            {source.raw}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function SourcePipelineStepper({ state }: { state: SourcePipelineState }) {
  return (
    <Card
      aria-labelledby="source-pipeline"
      className="grid gap-4 p-6"
    >
      <h2 id="source-pipeline" className="m-0 text-base font-semibold tracking-tight text-foreground">
        Pipeline
      </h2>
      {state.kind === "terminal" ? (
        <p
          data-testid="source-pipeline-terminal"
          className="m-0 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 font-semibold text-destructive"
          role="status"
        >
          Terminal state: {state.label}
        </p>
      ) : (
        <ol aria-label="Source pipeline stages" className="m-0 grid gap-2 p-0 sm:grid-cols-7">
          {SOURCE_PIPELINE_STAGES.map((stage, index) => {
            const currentIndex = SOURCE_PIPELINE_STAGES.indexOf(state.current);
            const status = index < currentIndex ? "Complete" : index === currentIndex ? "Current" : "Upcoming";
            return (
              <li
                key={stage}
                data-stage={stage}
                aria-current={status === "Current" ? "step" : undefined}
                className={`grid min-h-16 gap-1 rounded-xl border px-3 py-2 text-sm ${
                  status === "Current"
                    ? "border-primary bg-primary/15 text-primary"
                    : status === "Complete"
                      ? "border-border bg-card text-foreground"
                      : "border-border text-muted-foreground"
                }`}
              >
                <span className="font-semibold">{stage}</span>
                <span className="text-xs">{status}</span>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

function Message({ children }: { children: string }) {
  return (
    <div className="grid gap-8">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <Card
      aria-labelledby={id}
      className="grid gap-4 p-6"
    >
      <h2 id={id} className="m-0 text-base font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      {children}
    </Card>
  );
}
