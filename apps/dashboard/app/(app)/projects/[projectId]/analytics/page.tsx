"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { InstanceRecord } from "@/src/components/instance-workspace.types";
import { findInstanceById } from "@/src/components/instance-workspace.utils";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";
import { useResolvedProjectId } from "@/src/hooks/use-resolved-project-id";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/opengroow/page-header";
import { StatusBadge, type StatusTone } from "@/components/opengroow/status-badge";
import { PlatformLogo, platformName } from "@/src/components/platform-logo";
import { AnalyticsConnectionsCard } from "@/src/components/analytics-connections-card";

// The Analytics page (ADR-078): a Project's published posts with how they
// performed. Posts are ranked by their Mission type's primary metric within
// one platform only: the numbers of two platforms are never compared or added,
// and there is no total per Mission.

type AnalyticsRow = FunctionReturnType<typeof api.analytics.listForProject>[number];

/** `engagementTime` -> `engagement time`. */
const metricWords = (metric: string) => metric.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
const metricLabel = (metric: string) => {
  const words = metricWords(metric);
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** The Snapshots of the post the Publication has now (a retry that made a new post starts a new series). */
function currentSnapshots(row: AnalyticsRow) {
  const series = Math.max(0, ...row.snapshots.map((s) => s.postSeries));
  return row.snapshots.filter((s) => s.postSeries === series);
}

function latestMetrics(row: AnalyticsRow): Record<string, number> {
  return currentSnapshots(row).at(-1)?.metrics ?? {};
}

const STATES: Record<AnalyticsRow["state"], { label: string; tone: StatusTone }> = {
  unmeasured: { label: "Analytics unavailable", tone: "neutral" },
  waiting: { label: "Waiting for readings", tone: "progress" },
  no_data: { label: "No data yet", tone: "info" },
  failed: { label: "Failed", tone: "error" },
  post_unknown: { label: "Post unknown", tone: "warning" },
  complete: { label: "Complete", tone: "active" },
};

/** A small curve of one metric over the readings; colour comes from the text token. */
function Curve({ metric, values }: { metric: string; values: number[] }) {
  const width = 96;
  const height = 28;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const point = (value: number, index: number) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * (width - 4) + 2;
    const y = max === min ? height / 2 : height - 3 - ((value - min) / (max - min)) * (height - 6);
    return `${x},${y}`;
  };
  return (
    <svg role="img" aria-label={`${metricWords(metric)} over time: ${values.join(", ")}`} viewBox={`0 0 ${width} ${height}`} className="h-7 w-24 text-primary">
      {values.length > 1 ? (
        <polyline points={values.map(point).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      ) : (
        <circle cx={point(values[0], 0).split(",")[0]} cy={point(values[0], 0).split(",")[1]} r="3" fill="currentColor" />
      )}
    </svg>
  );
}

function PublicationRow({ row, rank }: { row: AnalyticsRow; rank?: number }) {
  const state = STATES[row.state];
  const snapshots = currentSnapshots(row);
  const latest = latestMetrics(row);
  const metrics = Object.keys(latest);
  // A reading that found nothing is "No data yet", not an error; the same words before the first reading of a waiting post.
  const label = row.state === "waiting" && snapshots.length === 0 ? "No data yet" : state.label;
  return (
    <li data-publication={row.publicationId} className="grid gap-3 border-t border-border px-5 py-4 first:border-t-0">
      <div className="flex flex-wrap items-center gap-3">
        {rank !== undefined ? <span className="w-8 text-sm font-semibold text-muted-foreground tabular-nums">#{rank}</span> : null}
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate font-medium text-foreground">{row.missionName}</span>
          <span className="truncate text-sm text-muted-foreground">
            {row.channelProfile ? `@${row.channelProfile}` : (row.channelName ?? row.target)}
            {row.source ? ` · From ${row.source.label}` : ""}
          </span>
        </div>
        <StatusBadge tone={state.tone} label={label} />
      </div>
      {metrics.length > 0 ? (
        <dl className="m-0 flex flex-wrap gap-x-8 gap-y-3">
          {metrics.map((metric) => (
            <div key={metric} className="flex items-center gap-3">
              <div className="grid gap-0.5">
                <dt className="text-sm text-muted-foreground">{metricLabel(metric)}</dt>
                <dd className={`m-0 text-lg tabular-nums ${metric === row.primaryMetric ? "font-semibold text-foreground" : "text-foreground"}`}>{latest[metric]}</dd>
              </div>
              <Curve metric={metric} values={snapshots.flatMap((s) => (s.metrics[metric] === undefined ? [] : [s.metrics[metric]]))} />
            </div>
          ))}
        </dl>
      ) : null}
      {row.reason ? <p className="m-0 text-sm text-muted-foreground">{row.reason}</p> : null}
      {row.nextAt !== undefined ? <p className="m-0 text-sm text-muted-foreground">Next reading: {new Date(row.nextAt).toLocaleDateString()}</p> : null}
    </li>
  );
}

/** Ranked first (highest primary metric), then the ones with no value yet in their original order. */
function ranked(rows: AnalyticsRow[]): Array<{ row: AnalyticsRow; rank?: number }> {
  const value = (row: AnalyticsRow) => (row.primaryMetric ? latestMetrics(row)[row.primaryMetric] : undefined);
  const withValue = rows.filter((r) => value(r) !== undefined).sort((a, b) => value(b)! - value(a)!);
  const without = rows.filter((r) => value(r) === undefined);
  return [...withValue.map((row, i) => ({ row, rank: i + 1 })), ...without.map((row) => ({ row }))];
}

export default function AnalyticsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const resolvedInstanceId = useResolvedProjectId(params);
  const instances = useAuthenticatedInstances<InstanceRecord>();
  const instanceId = findInstanceById(instances, resolvedInstanceId)?.openclawId;
  const rows = useQuery(api.analytics.listForProject, instanceId ? { instanceId } : "skip");

  const platforms = new Map<string, AnalyticsRow[]>();
  for (const row of rows ?? []) platforms.set(row.platform, [...(platforms.get(row.platform) ?? []), row]);

  return (
    <div className="grid gap-8">
      <PageHeader title="Analytics" description="How your published posts performed, ranked within each platform." />
      {rows === undefined ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground">No published posts yet. Their results appear here once they are published.</CardContent>
        </Card>
      ) : (
        Array.from(platforms, ([platform, platformRows]) => (
          <section key={platform} aria-label={platformName(platform)} className="grid gap-3">
            <h2 className="m-0 flex items-center gap-3 text-xl font-semibold">
              <PlatformLogo service={platform} adapter={platformRows[0].publisherAdapter} className="size-8" />
              {platformName(platform)}
            </h2>
            <Card className="py-0">
              <ul className="m-0 list-none p-0">
                {ranked(platformRows).map(({ row, rank }) => (
                  <PublicationRow key={row.publicationId} row={row} rank={rank} />
                ))}
              </ul>
            </Card>
          </section>
        ))
      )}
      <AnalyticsConnectionsCard instanceId={instanceId} />
    </div>
  );
}
