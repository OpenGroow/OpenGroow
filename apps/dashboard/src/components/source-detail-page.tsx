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
          className="w-fit text-[0.75rem] font-bold uppercase tracking-[0.18em] text-[var(--dashboard-ink-soft)] hover:text-[var(--dashboard-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dashboard-primary)] focus-visible:ring-offset-2"
        >
          ← Sources
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-1">
            <span className="text-[0.75rem] font-bold uppercase tracking-[0.18em] text-[var(--dashboard-ink-soft)]">
              {source.label} · {source.family}
            </span>
            <h1 className="m-0 break-words text-[clamp(1.6rem,3vw,2.5rem)] font-extrabold leading-[0.98] tracking-[-0.04em] text-[var(--dashboard-ink)]">
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
          <p className="m-0 text-[0.82rem] text-[var(--dashboard-ink-muted)]">
            Retry requested. It is picked up at the next run of the Agent&apos;s job.
          </p>
        ) : null}
        <p className="m-0 text-[0.82rem] text-[var(--dashboard-ink-muted)]">
          Observed {formatSourceDate(source.capturedAt)} ·{" "}
          <SchemaValue value={source.origin} />
        </p>
        {source.runId || source.sourceJobId ? (
          <p className="m-0 text-[0.82rem] text-[var(--dashboard-ink-muted)]">
            {source.runId && workspaceKey ? (
              <Link
                data-testid="source-run-link"
                href={runLogsHref(instanceId, source.templateId, source.runId)}
                className="font-bold text-[var(--dashboard-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dashboard-primary)] focus-visible:ring-offset-2"
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
            className="w-fit font-bold text-[var(--dashboard-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dashboard-primary)] focus-visible:ring-offset-2"
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
          className="rounded-[1.75rem] border border-[rgba(0,38,27,0.08)] bg-[#f8f9f7] p-6 shadow-[0_18px_34px_rgba(25,28,28,0.06)]"
        >
          <summary className="cursor-pointer text-[1.1rem] font-bold tracking-[-0.02em] text-[var(--dashboard-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dashboard-primary)] focus-visible:ring-offset-2">
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
        <details className="rounded-[1.75rem] border border-[rgba(0,38,27,0.08)] bg-[#f8f9f7] p-6 shadow-[0_18px_34px_rgba(25,28,28,0.06)]">
          <summary className="cursor-pointer text-[1.1rem] font-bold tracking-[-0.02em] text-[var(--dashboard-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dashboard-primary)] focus-visible:ring-offset-2">
            Raw
          </summary>
          <pre className="mt-4 max-h-[32rem] overflow-auto whitespace-pre-wrap break-all text-[0.8rem] text-[var(--dashboard-ink)]">
            {source.raw}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function SourcePipelineStepper({ state }: { state: SourcePipelineState }) {
  return (
    <section
      aria-labelledby="source-pipeline"
      className="grid gap-4 rounded-[1.75rem] border border-[rgba(0,38,27,0.08)] bg-[#f8f9f7] p-6 shadow-[0_18px_34px_rgba(25,28,28,0.06)]"
    >
      <h2 id="source-pipeline" className="m-0 text-[1.1rem] font-bold tracking-[-0.02em] text-[var(--dashboard-ink)]">
        Pipeline
      </h2>
      {state.kind === "terminal" ? (
        <p
          data-testid="source-pipeline-terminal"
          className="m-0 rounded-xl border border-[rgba(84,41,37,0.16)] bg-[rgba(84,41,37,0.06)] px-4 py-3 font-semibold text-[var(--dashboard-tertiary)]"
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
                className={`grid min-h-16 gap-1 rounded-xl border px-3 py-2 text-[0.82rem] ${
                  status === "Current"
                    ? "border-[var(--dashboard-primary)] bg-[rgba(188,237,215,0.7)] text-[var(--dashboard-primary)]"
                    : status === "Complete"
                      ? "border-[rgba(0,38,27,0.12)] bg-white text-[var(--dashboard-ink)]"
                      : "border-[rgba(0,38,27,0.08)] text-[var(--dashboard-ink-muted)]"
                }`}
              >
                <span className="font-semibold">{stage}</span>
                <span className="text-[0.72rem] uppercase tracking-[0.08em]">{status}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Message({ children }: { children: string }) {
  return (
    <div className="grid gap-8">
      <p className="text-[0.92rem] text-[var(--dashboard-ink-muted)]">{children}</p>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      className="grid gap-4 rounded-[1.75rem] border border-[rgba(0,38,27,0.08)] bg-[#f8f9f7] p-6 shadow-[0_18px_34px_rgba(25,28,28,0.06)]"
    >
      <h2 id={id} className="m-0 text-[1.1rem] font-bold tracking-[-0.02em] text-[var(--dashboard-ink)]">
        {title}
      </h2>
      {children}
    </section>
  );
}
