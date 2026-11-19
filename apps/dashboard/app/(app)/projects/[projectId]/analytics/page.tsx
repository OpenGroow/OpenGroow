"use client";

import { useState } from "react";
import Link from "next/link";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { BarChart3, ArrowDownRight, ArrowRight, ArrowUpRight, Crown, Eye, ExternalLink, Layers, Loader2, RefreshCw, Users } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { InstanceRecord } from "@/src/components/instance-workspace.types";
import { findInstanceById } from "@/src/components/instance-workspace.utils";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";
import { useResolvedProjectId } from "@/src/hooks/use-resolved-project-id";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/opengroow/page-header";
import { SearchField } from "@/components/opengroow/filter-bar";
import { StatTile } from "@/components/opengroow/stat-tile";
import { StatusBadge, type StatusTone } from "@/components/opengroow/status-badge";
import { PlatformLogo, platformName } from "@/src/components/platform-logo";
import { SourceThumbnail } from "@/src/components/source-visuals";
import {
  DEFAULT_COLUMNS,
  NO_DECLARATION,
  bestPost,
  byRank,
  changeOf,
  compact,
  currentReadings,
  formatValue,
  formatVariation,
  latestMetrics,
  rankValue,
  shownMetrics,
  totalsOf,
  valueOf,
  type Declaration,
  type MetricDecl,
} from "@/src/lib/analytics-figures";
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

/** The same words always have the same colour: "No data yet" is the info tone, whether the reading found nothing or none was taken yet. */
const stateTone = (row: AnalyticsRow): StatusTone => (stateLabel(row) === NO_DATA_LABEL ? STATES.no_data.tone : STATES[row.state].tone);
const stateLabel = (row: AnalyticsRow) => (row.state === "waiting" && currentReadings(row).length === 0 ? NO_DATA_LABEL : STATES[row.state].label);
const titleOf = (row: AnalyticsRow) => row.title ?? row.missionName;
const accountOf = (row: AnalyticsRow) => (row.channelProfile ? `@${row.channelProfile}` : (row.channelName ?? row.target));
const dateOf = (row: AnalyticsRow) => new Date(row.publishedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

const GRID = "grid items-center gap-4";
/** The post, the platform, the date, one column per shown metric, the chevron. */
const gridStyle = (columns: number) => ({ gridTemplateColumns: `minmax(0,2.4fr) minmax(0,1.4fr) minmax(0,1fr) repeat(${columns},minmax(0,0.8fr)) 1.5rem` });

/** The first frame of a video that has no cover: the browser loads the video itself, from its own URL. */
function VideoFrame({ url, className, fallback }: { url: string; className: string; fallback: React.ReactNode }) {
  const [broken, setBroken] = useState(false);
  if (broken) return fallback;
  return (
    <video
      src={`${url}#t=0.1`}
      muted
      playsInline
      preload="metadata"
      aria-hidden="true"
      tabIndex={-1}
      onError={() => setBroken(true)}
      className={cn("shrink-0 rounded-xl bg-muted object-cover", className)}
    />
  );
}

function Thumbnail({ row, className }: { row: AnalyticsRow; className: string }) {
  const source = { _id: row.publicationId, templateId: "", sourceId: "", label: titleOf(row), family: row.kind ?? "video", thumbnailUrl: row.thumbnailUrl ?? null };
  const thumbnail = <SourceThumbnail source={source} className={className} />;
  return !row.thumbnailUrl && row.videoUrl ? <VideoFrame url={row.videoUrl} className={className} fallback={thumbnail} /> : thumbnail;
}

/** How a metric moved since the previous reading: "+34" under a counter, an arrow (green improving, red worsening) for a level. */
function Change({ metric, row }: { metric: MetricDecl; row: AnalyticsRow }) {
  const change = changeOf(metric, row);
  if (!change) return null;
  if (change.kind === "variation") {
    const text = formatVariation(metric, change.delta);
    return text ? <span className="ml-1 text-sm text-muted-foreground">{text}</span> : null;
  }
  const Icon = change.direction === "up" ? ArrowUpRight : change.direction === "down" ? ArrowDownRight : ArrowRight;
  const tone = change.verdict === "improving" ? "text-status-success" : change.verdict === "worsening" ? "text-destructive" : "text-muted-foreground";
  const label = change.verdict === "improving" ? "Improving" : change.verdict === "worsening" ? "Worsening" : "Steady";
  return (
    <span role="img" aria-label={label} data-trend={change.verdict} className={cn("ml-1 inline-flex align-middle", tone)}>
      <Icon aria-hidden="true" className="size-4" />
    </span>
  );
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

function PostDetail({ row, declaration }: { row: AnalyticsRow; declaration: Declaration }) {
  const latest = latestMetrics(row);
  const metrics = shownMetrics(declaration, row);
  // Derived figures are never stored, so only a stored metric has a curve over time.
  const stored = metrics.filter((m) => !m.derive);
  const trended = (stored.find((m) => m.key === declaration.primary) ?? stored[0])?.key;
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
      <StatusBadge tone={stateTone(row)} label={stateLabel(row)} />
      {metrics.length > 0 ? (
        <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {metrics.map((metric) => (
            <div key={metric.key} className="grid gap-0.5 rounded-xl border border-border p-3">
              <dd className={cn("m-0 text-2xl tabular-nums", metric.key === declaration.primary ? "font-semibold" : "")}>{formatValue(metric, valueOf(metric, latest))}<Change metric={metric} row={row} /></dd>
              <dt className="text-sm text-muted-foreground">{metric.label}</dt>
            </div>
          ))}
        </dl>
      ) : null}
      {trended ? <Trend metric={trended} row={row} /> : null}
      {row.reason ? <p className="m-0 text-sm text-muted-foreground">{row.reason}</p> : null}
      {row.nextAt !== undefined ? <p className="m-0 text-sm text-muted-foreground">Next reading: {new Date(row.nextAt).toLocaleDateString()}</p> : null}
    </Card>
  );
}

function PostRow({ row, columns, selected, onSelect }: { row: AnalyticsRow; columns: MetricDecl[]; selected: boolean; onSelect: () => void }) {
  const latest = latestMetrics(row);
  const noReading = Object.keys(latest).length === 0;
  return (
    <li>
      <Button
        type="button"
        variant="outline"
        aria-pressed={selected}
        data-publication={row.publicationId}
        onClick={onSelect}
        style={gridStyle(columns.length)}
        className={cn(GRID, "h-auto w-full justify-normal rounded-xl bg-card px-4 py-3 text-left font-normal whitespace-normal")}
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
          <span className="text-sm text-muted-foreground" style={{ gridColumn: `span ${Math.max(columns.length, 1)}` }}>{stateLabel(row)}</span>
        ) : (
          <>
            {columns.map((metric) => (
              <span key={metric.key} className="tabular-nums">{formatValue(metric, valueOf(metric, latest))}<Change metric={metric} row={row} /></span>
            ))}
          </>
        )}
        <span aria-hidden="true" className="text-muted-foreground">›</span>
      </Button>
    </li>
  );
}

type Sort = "top" | "recent";

/** The metrics beyond the first four are chosen here; the choice is kept for the page's life. */
function ColumnsMenu({ extra, chosen, onToggle }: { extra: MetricDecl[]; chosen: Set<string>; onToggle: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  if (extra.length === 0) return null;
  return (
    <div className="relative">
      <Button type="button" variant="outline" size="lg" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Columns
      </Button>
      {open ? (
        <div role="group" aria-label="Columns" className="absolute right-0 z-10 mt-2 grid min-w-48 gap-2 rounded-xl border border-border bg-popover p-3 shadow-md">
          {extra.map((metric) => (
            <label key={metric.key} className="flex items-center gap-2 text-sm">
              <Checkbox checked={chosen.has(metric.key)} onCheckedChange={() => onToggle(metric.key)} />
              {metric.label}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

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
  // The picker lists the Project's adapters, the first activated first; numbers of two adapters are never mixed (ADR-079).
  const adapters = useQuery(api.analytics.adaptersForProject, instanceId ? { instanceId } : "skip");
  const [adapterId, setAdapterId] = useState<string | null>(null);
  const current = adapters?.find((a) => a.adapter === adapterId) ?? adapters?.[0];
  const unavailable = useQuery(api.analytics.unavailableForProject, instanceId ? { instanceId } : "skip") ?? [];
  const rows = useQuery(api.analytics.listForProject, instanceId ? { instanceId, ...(current ? { adapter: current.adapter } : {}) } : "skip");
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("all");
  const [sort, setSort] = useState<Sort>("top");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const declaration: Declaration = current ? { metrics: current.metrics, primary: current.primary } : NO_DECLARATION;
  function chooseAdapter(next: string) {
    setAdapterId(next);
    setChosen(new Set());
    setSelectedId(null);
  }
  const extra = declaration.metrics.slice(DEFAULT_COLUMNS);
  const columns = declaration.metrics.filter((m, i) => i < DEFAULT_COLUMNS || chosen.has(m.key));
  const toggleColumn = (key: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const all = rows ?? [];
  const totals = totalsOf(declaration, all);
  const best = bestPost(declaration, all);
  const primary = declaration.metrics.find((m) => m.key === declaration.primary);
  const firstDerived = declaration.metrics.find((m) => m.derive);
  const platforms = [...new Set(all.map((row) => row.platform))].sort();
  const needle = search.trim().toLowerCase();
  const visible = all
    .filter((row) => (platform === "all" || row.platform === platform) && (needle === "" || `${titleOf(row)} ${accountOf(row)}`.toLowerCase().includes(needle)))
    .sort((a, b) => (sort === "recent" ? b.publishedAt - a.publishedAt : byRank(declaration)(a, b)));
  const selected = visible.find((row) => row.publicationId === selectedId) ?? visible[0];

  return (
    <div className="grid gap-8">
      <PageHeader title="Analytics" description="How your published posts performed." action={<RefreshButton instanceId={instanceId} />} />
      {adapters && adapters.length > 1 ? (
        <div className="flex gap-2 border-b border-border" role="tablist" aria-label="Analytics adapter">
          {adapters.map((a) => {
            const active = a.adapter === current?.adapter;
            return (
              <button
                key={a.adapter}
                type="button"
                role="tab"
                aria-selected={active}
                className={`flex items-center gap-2 border-b-2 px-4 pb-3 text-sm font-medium ${
                  active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => chooseAdapter(a.adapter)}
              >
                {a.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.icon} alt="" className="size-4 rounded-sm object-contain" />
                ) : (
                  <BarChart3 className="size-4" aria-hidden="true" />
                )}
                {a.name}
              </button>
            );
          })}
        </div>
      ) : null}
      {rows === undefined ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : all.length === 0 && unavailable.length === 0 ? (
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
            {primary ? <StatTile icon={Eye} label={primary.type === "counter" ? `Total ${primary.label.toLowerCase()}` : primary.label} value={formatValue(primary, totals.values[primary.key])} tone="research" /> : null}
            {firstDerived ? <StatTile icon={Users} label={firstDerived.label} value={formatValue(firstDerived, totals.values[firstDerived.key])} tone="engagement" /> : null}
            <Card data-slot="stat-tile" className="flex-row items-center gap-5 px-6 py-6">
              {best ? <Thumbnail row={best} className="size-14" /> : <span className="flex size-14 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Crown className="size-7" /></span>}
              <div className="grid min-w-0 gap-0.5">
                <div className="truncate text-base font-semibold">{best ? titleOf(best) : "—"}</div>
                <div className="text-base text-muted-foreground">Top performing post{best && primary ? ` · ${formatValue(primary, rankValue(declaration, best))} ${primary.label.toLowerCase()}` : ""}</div>
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
            <ColumnsMenu extra={extra} chosen={chosen} onToggle={toggleColumn} />
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">No posts match these filters.</p>
          ) : (
            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="grid gap-3">
                <div aria-hidden="true" data-slot="columns-header" style={gridStyle(columns.length)} className={cn(GRID, "px-4 text-sm text-muted-foreground max-lg:hidden")}>
                  <span>Post</span>
                  <span>Platform / Account</span>
                  <span>Published</span>
                  {columns.map((metric) => (
                    <span key={metric.key}>{metric.label}</span>
                  ))}
                  <span />
                </div>
                <ul className="m-0 grid list-none gap-3 p-0">
                  {visible.map((row) => (
                    <PostRow key={row.publicationId} row={row} columns={columns} selected={row.publicationId === selected?.publicationId} onSelect={() => setSelectedId(row.publicationId)} />
                  ))}
                </ul>
              </div>
              {selected ? <PostDetail row={selected} declaration={declaration} /> : null}
            </div>
          )}
        </>
      )}
      {unavailable.length > 0 ? (
        <section aria-label="Analytics unavailable" className="grid gap-3">
          <h2 className="text-lg font-semibold">Analytics unavailable</h2>
          <p className="text-sm text-muted-foreground">
            These posts are not measured: their channel has no analytics provider. Link one in{" "}
            <Link href="publishers" className="underline underline-offset-4">Publishers &amp; Analytics</Link>.
          </p>
          <ul className="m-0 grid list-none gap-2 p-0">
            {unavailable.map((row) => (
              <li key={row.publicationId} className="rounded-xl border px-4 py-3 text-sm">
                <span className="font-medium">{row.missionName}</span>
                <span className="text-muted-foreground"> · {platformName(row.platform)}{row.channelName ? ` · ${row.channelName}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
