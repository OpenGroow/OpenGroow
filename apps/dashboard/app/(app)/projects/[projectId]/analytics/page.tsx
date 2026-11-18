"use client";

import { useState } from "react";
import Link from "next/link";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Crown, Eye, ExternalLink, Layers, Loader2, RefreshCw, Users } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { InstanceRecord } from "@/src/components/instance-workspace.types";
import { findInstanceById } from "@/src/components/instance-workspace.utils";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";
import { useResolvedProjectId } from "@/src/hooks/use-resolved-project-id";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/opengroow/page-header";
import { SearchField } from "@/components/opengroow/filter-bar";
import { StatTile } from "@/components/opengroow/stat-tile";
import { StatusBadge, type StatusTone } from "@/components/opengroow/status-badge";
import { PlatformLogo, platformName } from "@/src/components/platform-logo";
import { SourceThumbnail } from "@/src/components/source-visuals";
import { compact, currentReadings, engagementRate, latestMetrics, percent, rankValue, totalsOf } from "@/src/lib/analytics-figures";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import { cn } from "@/lib/utils";

// The Analytics page (ADR-078): the Project's measured posts, the way the Sources
// page lists Sources: totals on top, a toolbar, the list and the selected post.
// A post with no Analytics Adapter is not listed: there is nothing to show.

type AnalyticsRow = FunctionReturnType<typeof api.analytics.listForProject>[number];

/** `engagementTime` -> `Engagement time`. */
const metricLabel = (metric: string) => {
  const words = metric.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** A reading that found nothing is "No data yet", not an error. */
const NO_DATA_LABEL = "No data yet";

const STATES: Record<AnalyticsRow["state"], { label: string; tone: StatusTone }> = {
  waiting: { label: "Waiting for readings", tone: "progress" },
  no_data: { label: NO_DATA_LABEL, tone: "info" },
  failed: { label: "Failed", tone: "error" },
  post_unknown: { label: "Post unknown", tone: "warning" },
  complete: { label: "Complete", tone: "active" },
};

const stateLabel = (row: AnalyticsRow) => (row.state === "waiting" && currentReadings(row).length === 0 ? NO_DATA_LABEL : STATES[row.state].label);
const titleOf = (row: AnalyticsRow) => row.title ?? row.missionName;
const accountOf = (row: AnalyticsRow) => (row.channelProfile ? `@${row.channelProfile}` : (row.channelName ?? row.target));
const dateOf = (row: AnalyticsRow) => new Date(row.publishedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

const GRID = "grid grid-cols-[minmax(0,2.4fr)_minmax(0,1.4fr)_minmax(0,1fr)_repeat(4,minmax(0,0.8fr))_1.5rem] items-center gap-4";

function Thumbnail({ row, className }: { row: AnalyticsRow; className: string }) {
  const source = { _id: row.publicationId, templateId: "", sourceId: "", label: titleOf(row), family: row.kind ?? "video", thumbnailUrl: row.thumbnailUrl ?? null };
  return <SourceThumbnail source={source} className={className} />;
}

/** One metric over the readings, with its dates: the shape of how the post grew. */
function Trend({ metric, row }: { metric: string; row: AnalyticsRow }) {
  const points = currentReadings(row).flatMap((s) => (s.metrics[metric] === undefined ? [] : [{ at: s.takenAt, value: s.metrics[metric] }]));
  if (points.length === 0) return null;
  const width = 320;
  const height = 120;
  const max = Math.max(...points.map((p) => p.value));
  const min = Math.min(0, ...points.map((p) => p.value));
  const x = (i: number) => (points.length === 1 ? width / 2 : (i / (points.length - 1)) * (width - 16) + 8);
  const y = (value: number) => (max === min ? height / 2 : height - 8 - ((value - min) / (max - min)) * (height - 16));
  const day = (at: number) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <div className="grid gap-2">
      <h4 className="m-0 text-base font-medium">{metricLabel(metric)} over time</h4>
      <svg role="img" aria-label={`${metricLabel(metric)} over time: ${points.map((p) => p.value).join(", ")}`} viewBox={`0 0 ${width} ${height}`} className="h-32 w-full text-primary">
        {points.length > 1 ? (
          <polyline points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        ) : null}
        {points.map((p, i) => (
          <circle key={p.at} cx={x(i)} cy={y(p.value)} r="4" fill="currentColor" />
        ))}
      </svg>
      <div className="flex justify-between text-sm text-muted-foreground">
        <span>{day(points[0].at)}</span>
        <span>{points.length > 1 ? day(points.at(-1)!.at) : null}</span>
      </div>
    </div>
  );
}

function PostDetail({ row }: { row: AnalyticsRow }) {
  const latest = latestMetrics(row);
  const metrics = Object.keys(latest);
  const trended = row.primaryMetric && latest[row.primaryMetric] !== undefined ? row.primaryMetric : (metrics.includes("views") ? "views" : metrics[0]);
  return (
    <Card aria-label="Selected post" className="grid content-start gap-5 p-6">
      <div className="flex gap-4">
        <Thumbnail row={row} className="size-24" />
        <div className="grid min-w-0 flex-1 content-start gap-2">
          <h3 className="m-0 text-xl leading-snug font-semibold">{titleOf(row)}</h3>
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <PlatformLogo service={row.platform} adapter={row.publisherAdapter} className="size-5" />
            {platformName(row.platform)} · {accountOf(row)}
          </span>
          <span className="text-sm text-muted-foreground">Published {dateOf(row)}</span>
        </div>
        {row.externalUrl ? (
          <a href={row.externalUrl} target="_blank" rel="noreferrer" aria-label="Open the post" className="shrink-0 text-muted-foreground hover:text-foreground">
            <ExternalLink className="size-5" />
          </a>
        ) : null}
      </div>
      <StatusBadge tone={STATES[row.state].tone} label={stateLabel(row)} />
      {metrics.length > 0 ? (
        <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {metrics.map((metric) => (
            <div key={metric} className="grid gap-0.5 rounded-xl border border-border p-3">
              <dd className={cn("m-0 text-2xl tabular-nums", metric === row.primaryMetric ? "font-semibold" : "")}>{compact(latest[metric])}</dd>
              <dt className="text-sm text-muted-foreground">{metricLabel(metric)}</dt>
            </div>
          ))}
          {engagementRate(latest) !== undefined ? (
            <div className="grid gap-0.5 rounded-xl border border-border p-3">
              <dd className="m-0 text-2xl tabular-nums">{percent(engagementRate(latest))}</dd>
              <dt className="text-sm text-muted-foreground">Engagement</dt>
            </div>
          ) : null}
        </dl>
      ) : null}
      {trended ? <Trend metric={trended} row={row} /> : null}
      {row.reason ? <p className="m-0 text-sm text-muted-foreground">{row.reason}</p> : null}
      {row.nextAt !== undefined ? <p className="m-0 text-sm text-muted-foreground">Next reading: {new Date(row.nextAt).toLocaleDateString()}</p> : null}
    </Card>
  );
}

function PostRow({ row, selected, onSelect }: { row: AnalyticsRow; selected: boolean; onSelect: () => void }) {
  const latest = latestMetrics(row);
  const noReading = Object.keys(latest).length === 0;
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        data-publication={row.publicationId}
        onClick={onSelect}
        className={cn(GRID, "w-full rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:bg-muted", selected ? "border-primary bg-primary/10" : "border-border")}
      >
        <span className="flex min-w-0 items-center gap-3">
          <Thumbnail row={row} className="size-14" />
          <span className="grid min-w-0 gap-1">
            <span className="line-clamp-2 font-medium">{titleOf(row)}</span>
            {row.kind ? <Badge variant="outline" className="w-fit capitalize">{row.kind}</Badge> : null}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <PlatformLogo service={row.platform} adapter={row.publisherAdapter} className="size-6" />
          <span className="grid min-w-0 text-sm">
            <span className="truncate font-medium">{platformName(row.platform)}</span>
            <span className="truncate text-muted-foreground">{accountOf(row)}</span>
          </span>
        </span>
        <span className="text-sm text-muted-foreground">{dateOf(row)}</span>
        {noReading ? (
          <span className="col-span-4 text-sm text-muted-foreground">{stateLabel(row)}</span>
        ) : (
          <>
            <span className="tabular-nums">{compact(latest.views)}</span>
            <span className="tabular-nums">{compact(latest.likes)}</span>
            <span className="tabular-nums">{compact(latest.comments)}</span>
            <span className="tabular-nums">{percent(engagementRate(latest))}</span>
          </>
        )}
        <span aria-hidden="true" className="text-muted-foreground">›</span>
      </button>
    </li>
  );
}

type Sort = "top" | "recent";

/** Reads every post's statistics now, outside the schedule, and says how it went. */
function RefreshButton({ instanceId }: { instanceId: string | undefined }) {
  const refresh = useAction(api.analytics_node.refresh);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: StatusTone; text: string } | null>(null);

  async function handleRefresh() {
    if (!instanceId) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await refresh({ instanceId });
      const posts = (n: number) => `${n} ${n === 1 ? "post" : "posts"}`;
      if (result.failed > 0) setMessage({ tone: "error", text: `${posts(result.failed)} could not be read${result.error ? `: ${result.error}` : ""}` });
      else if (result.read === 0) setMessage({ tone: "info", text: "Nothing to read yet" });
      else setMessage({ tone: "active", text: `${posts(result.read)} updated${result.unavailable > 0 ? `, ${result.unavailable} not available yet` : ""}` });
    } catch (error) {
      setMessage({ tone: "error", text: extractConvexErrorMessage(error, "Could not refresh") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {message ? <StatusBadge tone={message.tone} label={message.text} /> : null}
      <Button type="button" variant="outline" size="lg" disabled={!instanceId || busy} onClick={() => void handleRefresh()}>
        {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
        Refresh
      </Button>
    </div>
  );
}

export default function AnalyticsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const resolvedInstanceId = useResolvedProjectId(params);
  const instances = useAuthenticatedInstances<InstanceRecord>();
  const instanceId = findInstanceById(instances, resolvedInstanceId)?.openclawId;
  const rows = useQuery(api.analytics.listForProject, instanceId ? { instanceId } : "skip");
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("all");
  const [sort, setSort] = useState<Sort>("top");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const all = rows ?? [];
  const totals = totalsOf(all);
  const best = all.reduce<AnalyticsRow | undefined>((top, row) => ((rankValue(row) ?? -1) > (top ? (rankValue(top) ?? -1) : -1) ? row : top), undefined);
  const platforms = [...new Set(all.map((row) => row.platform))].sort();
  const needle = search.trim().toLowerCase();
  const visible = all
    .filter((row) => (platform === "all" || row.platform === platform) && (needle === "" || `${titleOf(row)} ${accountOf(row)}`.toLowerCase().includes(needle)))
    .sort((a, b) => (sort === "recent" ? b.publishedAt - a.publishedAt : (rankValue(b) ?? -1) - (rankValue(a) ?? -1)));
  const selected = visible.find((row) => row.publicationId === selectedId) ?? visible[0];

  return (
    <div className="grid gap-8">
      <PageHeader title="Analytics" description="How your published posts performed." action={<RefreshButton instanceId={instanceId} />} />
      {rows === undefined ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : all.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground">
            No measured posts yet. A published post is measured when its Mission type declares <code>analytics</code> in its Template and its channel has an analytics provider (see{" "}
            <Link href="publishers" className="underline underline-offset-4">Publishers &amp; Analytics</Link>). Refresh reads the posts already published.
          </CardContent>
        </Card>
      ) : (
        <>
          <section aria-label="Totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile icon={Layers} label="Measured posts" value={totals.posts} tone="visual" />
            <StatTile icon={Eye} label="Total views" value={compact(totals.views)} tone="research" />
            <StatTile icon={Users} label="Engagement" value={percent(totals.engagement)} tone="engagement" />
            <Card data-slot="stat-tile" className="flex-row items-center gap-5 px-6 py-6">
              {best ? <Thumbnail row={best} className="size-14" /> : <span className="flex size-14 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Crown className="size-7" /></span>}
              <div className="grid min-w-0 gap-0.5">
                <div className="truncate text-base font-semibold">{best ? titleOf(best) : "—"}</div>
                <div className="text-base text-muted-foreground">Top performing post{best ? ` · ${compact(rankValue(best))} ${best.primaryMetric ? metricLabel(best.primaryMetric).toLowerCase() : "views"}` : ""}</div>
              </div>
            </Card>
          </section>

          <div className="flex flex-col gap-3 sm:flex-row">
            <SearchField value={search} onChange={setSearch} label="Search posts" placeholder="Search posts…" className="lg:flex-1" />
            <NativeSelect aria-label="Filter by platform" className="h-11 sm:w-44" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="all">All platforms</option>
              {platforms.map((p) => (
                <option key={p} value={p}>
                  {platformName(p)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Sort posts" className="h-11 sm:w-44" value={sort} onChange={(e) => setSort(e.target.value === "recent" ? "recent" : "top")}>
              <option value="top">Top performing</option>
              <option value="recent">Most recent</option>
            </NativeSelect>
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">No posts match these filters.</p>
          ) : (
            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="grid gap-3">
                <div aria-hidden="true" className={cn(GRID, "px-4 text-sm text-muted-foreground max-lg:hidden")}>
                  <span>Post</span>
                  <span>Platform / Account</span>
                  <span>Published</span>
                  <span>Views</span>
                  <span>Likes</span>
                  <span>Comments</span>
                  <span>Engagement</span>
                  <span />
                </div>
                <ul className="m-0 grid list-none gap-3 p-0">
                  {visible.map((row) => (
                    <PostRow key={row.publicationId} row={row} selected={row.publicationId === selected?.publicationId} onSelect={() => setSelectedId(row.publicationId)} />
                  ))}
                </ul>
              </div>
              {selected ? <PostDetail row={selected} /> : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}
