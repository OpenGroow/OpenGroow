"use client";

import Link from "next/link";
import { use } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import { runLogsHref } from "@/src/lib/instance-path";
import { SchemaFields, SchemaValue, type JsonSchema } from "@/src/components/schema-value";
import { SOURCE_PIPELINE_STAGES, deriveSourcePipelineState, type SourcePipelineState } from "@/src/lib/source-pipeline";
import { formatSourceDate, SourcePipelinePill } from "@/src/components/source-status-pill";
import { Card } from "@/components/ui/card";

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
  const forceProduction = useMutation(api.source_routing.forceProduction);

  if (result === undefined) return <Message>Loading…</Message>;
  if (result === null) return <Message>Source not found.</Message>;

  const { source, analysisSchema, workspaceKey } = result;
  const marketing = source.marketing as Record<string, unknown>;
  const scoring = (source.scoring ?? {}) as Record<string, unknown>;
  const analysis = (source.analysis ?? {}) as Record<string, unknown>;
  const pipeline = deriveSourcePipelineState(source);

  // `routing` only produces something for `video`/
  // `carousel` social Sources — an `image` one, or one not yet enriched (so
  // there are no creative features yet), silently no-ops. Gating the button on
  // the same condition avoids a click that looks like it worked but produced
  // nothing.
  const creativeFeatures = analysis.creativeFeatures as { mediaType?: unknown } | undefined;
  const canForceProduction =
    source.templateId === "@opengroow/social-engagement" &&
    source.status === "ready" &&
    (creativeFeatures?.mediaType === "video" || creativeFeatures?.mediaType === "carousel");

  async function handleForceProduction(): Promise<void> {
    try {
      await forceProduction({ sourceId: sourceId as Id<"sources"> });
    } catch (error: unknown) {
      window.alert(extractConvexErrorMessage(error, "Failed to start production."));
    }
  }

  async function handleRetry(): Promise<void> {
    try {
      await retry({ sourceId: sourceId as Id<"sources"> });
    } catch (error: unknown) {
      window.alert(extractConvexErrorMessage(error, "Failed to retry the Source."));
    }
  }

  return (
    <div className="grid max-w-[920px] gap-8" data-testid="source-detail">
      <header className="grid gap-3">
        <Link
          href={`/projects/${encodeURIComponent(instanceId)}/sources`}
          className="w-fit text-xs font-semibold text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          ← Sources
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-1">
            <span className="text-xs font-semibold text-muted-foreground">
              {source.label} · {source.family}
            </span>
            <h1 className="m-0 text-3xl font-bold tracking-tight break-words text-foreground sm:text-4xl">
              {source.marketing.summary ?? source.origin}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SourcePipelinePill source={source} />
            {source.status === "failed" ? (
              <Button type="button" variant="outline" onClick={() => void handleRetry()}>
                Retry
              </Button>
            ) : null}
            {canForceProduction ? (
              <Button type="button" variant="outline" onClick={() => void handleForceProduction()}>
                {source.selectedAt !== undefined ? "Produce again" : "Force production"}
              </Button>
            ) : null}
          </div>
        </div>
        {source.status === "processing" && source.retryRequested ? (
          <p className="m-0 text-sm text-muted-foreground">
            Retry requested. It is picked up at the next run of the Agent&apos;s job.
          </p>
        ) : null}
        <p className="m-0 text-sm text-muted-foreground">
          Observed {formatSourceDate(source.capturedAt)} ·{" "}
          <SchemaValue value={source.origin} />
        </p>
        {source.runId || source.sourceJobId ? (
          <p className="m-0 text-sm text-muted-foreground">
            {source.runId && workspaceKey ? (
              <Link
                data-testid="source-run-link"
                href={runLogsHref(instanceId, source.templateId, source.runId)}
                className="font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                View Run
              </Link>
            ) : null}
            {source.runId && workspaceKey && source.sourceJobId ? " · " : null}
            {source.sourceJobId ? <>Job {source.sourceJobId}</> : null}
          </p>
        ) : null}
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
