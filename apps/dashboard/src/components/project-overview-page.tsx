"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  ArrowRight,
  Bot,
  CheckCheck,
  CircleAlert,
  CircleCheck,
  CirclePause,
  CircleStop,
  Clock,
  Layers,
  LoaderCircle,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useProjectManifests } from "@/src/hooks/use-project-manifests";
import { relativeTime } from "@/src/lib/relative-time";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AgentAvatar } from "@/components/opengroow/agent-avatar";
import { AGENT_TONE_CLASSES, type AgentTone } from "@/components/opengroow/agent-presentation";
import { FilterChips } from "@/components/opengroow/filter-bar";
import { AreaChart, DonutChart, Sparkline } from "@/components/opengroow/overview-charts";
import { PageHeader } from "@/components/opengroow/page-header";

type Days = 7 | 30 | 90;
type Group = "done" | "progress" | "review" | "failed" | "stopped";

const RANGES: Array<{ id: string; label: string }> = [
  { id: "7", label: "Last 7 days" },
  { id: "30", label: "Last 30 days" },
  { id: "90", label: "Last 90 days" },
];

// One colour per outcome group (DESIGN.md "Colour roles"): green done, cyan in
// progress, amber waiting for a human, red failed, slate stopped.
const GROUPS: Record<Group, { label: string; text: string; dot: string }> = {
  done: { label: "Completed", text: "text-tone-green", dot: "bg-tone-green" },
  progress: { label: "In progress", text: "text-tone-cyan", dot: "bg-tone-cyan" },
  review: { label: "Needs review", text: "text-status-warning", dot: "bg-status-warning" },
  failed: { label: "Failed", text: "text-status-error", dot: "bg-status-error" },
  stopped: { label: "Stopped", text: "text-tone-slate", dot: "bg-tone-slate" },
};

// What a Mission's latest status reads as in the activity feed.
const ACTIVITY: Record<string, { title: string; icon: LucideIcon; group: Group }> = {
  done: { title: "Mission completed", icon: CircleCheck, group: "done" },
  approved: { title: "Ready to publish", icon: CircleCheck, group: "review" },
  to_validate: { title: "Ready for review", icon: CirclePause, group: "review" },
  blocked: { title: "Mission blocked", icon: CirclePause, group: "review" },
  doing: { title: "Mission in progress", icon: LoaderCircle, group: "progress" },
  todo: { title: "Mission queued", icon: LoaderCircle, group: "progress" },
  failed: { title: "Mission failed", icon: CircleAlert, group: "failed" },
  cancelled: { title: "Mission stopped", icon: CircleStop, group: "stopped" },
};

const GROUP_TILE: Record<Group, string> = {
  done: "bg-tone-green/15 text-tone-green",
  progress: "bg-tone-cyan/15 text-tone-cyan",
  review: "bg-status-warning/15 text-status-warning",
  failed: "bg-status-error/15 text-status-error",
  stopped: "bg-tone-slate/15 text-tone-slate",
};

function formatDuration(ms: number | null): string {
  if (ms === null) return "–";
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}

function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

function titleCase(type: string): string {
  return type
    .split("_")
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

function slugOf(templateId: string): string {
  return titleCase((templateId.split("/").pop() ?? templateId).replace(/-/g, "_"));
}

function Delta({ current, previous, better }: { current: number | null; previous: number | null; better?: "up" | "down" }) {
  if (current === null || previous === null || previous === 0) return null;
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return <span className="text-sm text-muted-foreground tabular-nums">0%</span>;
  const Icon = change > 0 ? TrendingUp : TrendingDown;
  const good = better === undefined ? undefined : (change > 0) === (better === "up");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-sm font-medium tabular-nums",
        good === undefined ? "text-muted-foreground" : good ? "text-tone-green" : "text-status-error",
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      {change > 0 ? "+" : ""}
      {change}%
    </span>
  );
}

function OverviewTile({
  icon: Icon,
  tone,
  label,
  value,
  delta,
  footnote,
  chart,
}: {
  icon: LucideIcon;
  tone: AgentTone;
  label: string;
  value: React.ReactNode;
  delta?: React.ReactNode;
  footnote: string;
  chart?: React.ReactNode;
}) {
  return (
    <Card data-slot="overview-tile" className="gap-3 px-5 pt-5 pb-0">
      <div className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className={cn("flex size-12 shrink-0 items-center justify-center rounded-xl", AGENT_TONE_CLASSES[tone])}
        >
          <Icon className="size-6" />
        </span>
        <div className="grid min-w-0 gap-1">
          <span className="text-base text-muted-foreground">{label}</span>
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="text-4xl leading-none font-semibold tabular-nums text-foreground">{value}</span>
            {delta}
          </div>
          <span className="text-sm text-muted-foreground">{footnote}</span>
        </div>
      </div>
      <div className="-mx-5 mt-auto h-12">{chart}</div>
    </Card>
  );
}

function PanelTitle({ children, href, linkLabel }: { children: React.ReactNode; href?: string; linkLabel?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-6">
      <h2 className="m-0 text-xl font-semibold text-foreground">{children}</h2>
      {href ? (
        <Link href={href} className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          {linkLabel ?? "View all"}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading overview">
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="h-44 animate-pulse" />
        ))}
      </div>
      <Card className="h-80 animate-pulse" />
    </div>
  );
}

export function ProjectOverviewPage({ projectId }: { projectId: string }) {
  const [days, setDays] = React.useState<Days>(30);
  // Rounded to the hour so the query arguments stay stable between renders.
  const [until] = React.useState(() => Math.ceil(Date.now() / 3_600_000) * 3_600_000);
  const tzOffsetMinutes = React.useMemo(() => new Date().getTimezoneOffset(), []);

  const overview = useQuery(api.project_overview.projectOverview, {
    instanceId: projectId,
    days,
    until,
    tzOffsetMinutes,
  });
  const agentRecords = useQuery(api.project_agents.listByInstance, { instanceId: projectId });
  const { manifests } = useProjectManifests(projectId);

  const projectPath = `/projects/${encodeURIComponent(projectId)}`;
  const manifestOf = (templateId: string) => manifests.find((m) => m.id === templateId);
  const agentName = (templateId: string) => manifestOf(templateId)?.name ?? slugOf(templateId);

  const header = (
    <PageHeader
      title="Overview"
      description="How your agents are doing over time."
      action={
        <FilterChips
          label="Period"
          options={RANGES}
          value={String(days)}
          onChange={(id) => setDays(Number(id) as Days)}
        />
      }
    />
  );

  if (overview === undefined) {
    return (
      <>
        {header}
        <Skeleton />
      </>
    );
  }
  if (overview === null) {
    return (
      <>
        {header}
        <p className="m-0 text-base text-muted-foreground">This project could not be loaded.</p>
      </>
    );
  }

  const more = overview.truncated ? "+" : "";
  const activeAgents = agentRecords?.filter((a) => a.status === "active").length;
  const installedAgents = agentRecords?.length;
  const dayLabel = (start: number) => new Date(start).toLocaleDateString("en", { month: "short", day: "numeric" });
  const labels = overview.buckets.map((b) => dayLabel(b.start));
  const comparison = `vs previous ${days} days`;

  const slices = (Object.keys(GROUPS) as Group[])
    .map((group) => ({
      id: group,
      label: GROUPS[group].label,
      value: overview.counts[group],
      className: GROUPS[group].text,
    }))
    // "Stopped" only appears once a Mission was actually stopped.
    .filter((slice) => slice.id !== "stopped" || slice.value > 0);

  return (
    <>
      {header}

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <OverviewTile
          icon={Layers}
          tone="creative"
          label="Total Missions"
          value={`${overview.total}${more}`}
          delta={<Delta current={overview.total} previous={overview.previous.total} />}
          footnote={comparison}
          chart={<Sparkline values={overview.buckets.map((b) => b.total)} className="text-tone-violet" />}
        />
        <OverviewTile
          icon={CheckCheck}
          tone="engagement"
          label="Completed"
          value={`${overview.counts.done}${more}`}
          delta={<Delta current={overview.counts.done} previous={overview.previous.done} better="up" />}
          footnote={comparison}
          chart={<Sparkline values={overview.buckets.map((b) => b.done)} className="text-tone-green" />}
        />
        <OverviewTile
          icon={Clock}
          tone="research"
          label="Avg. run time"
          value={formatDuration(overview.avgRunMs)}
          delta={<Delta current={overview.avgRunMs} previous={overview.previous.avgRunMs} better="down" />}
          footnote={comparison}
          chart={
            <Sparkline values={overview.buckets.map((b) => b.avgRunMs ?? 0)} className="text-tone-cyan" />
          }
        />
        <OverviewTile
          icon={Bot}
          tone="visual"
          label="Active agents"
          value={activeAgents ?? "–"}
          footnote={installedAgents === undefined ? "" : `of ${installedAgents} installed`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="gap-5 py-6">
          <PanelTitle>Missions over time</PanelTitle>
          {overview.total === 0 ? (
            <p className="m-0 px-6 text-base text-muted-foreground">No Missions in this period.</p>
          ) : (
            <div className="grid gap-4 px-6">
              <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0 text-sm text-muted-foreground">
                {(["done", "progress", "review", "failed"] as const).map((group) => (
                  <li key={group} className="flex items-center gap-2">
                    <span aria-hidden="true" className={cn("size-2 rounded-full", GROUPS[group].dot)} />
                    {GROUPS[group].label}
                  </li>
                ))}
              </ul>
              <AreaChart
                labels={labels}
                series={(["done", "progress", "review", "failed"] as const).map((group) => ({
                  id: group,
                  label: GROUPS[group].label,
                  className: GROUPS[group].text,
                  values: overview.buckets.map((b) => b[group]),
                }))}
              />
            </div>
          )}
        </Card>

        <Card className="gap-5 py-6">
          <PanelTitle>Mission status</PanelTitle>
          <div className="flex flex-wrap items-center gap-8 px-6">
            <DonutChart slices={slices}>
              <span className="text-4xl leading-none font-semibold tabular-nums text-foreground">
                {overview.total}
                {more}
              </span>
              <span className="text-sm text-muted-foreground">Missions</span>
            </DonutChart>
            <ul className="m-0 grid min-w-48 flex-1 list-none gap-3 p-0">
              {slices.map((slice) => (
                <li key={slice.id} className="flex items-center gap-3 text-base">
                  <span aria-hidden="true" className={cn("size-2.5 rounded-full", GROUPS[slice.id as Group].dot)} />
                  <span className="flex-1 text-foreground">{slice.label}</span>
                  <span className="font-medium text-foreground tabular-nums">{slice.value}</span>
                  <span className="w-10 text-right text-sm text-muted-foreground tabular-nums">
                    {percent(slice.value, overview.total)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="gap-4 py-6">
          <PanelTitle href={`${projectPath}/agents`}>Top agents by activity</PanelTitle>
          {overview.agents.length === 0 ? (
            <p className="m-0 px-6 text-base text-muted-foreground">No agent activity in this period.</p>
          ) : (
            <div className="overflow-x-auto px-6">
              <table className="w-full min-w-96 border-collapse text-left">
                <thead>
                  <tr className="text-sm text-muted-foreground">
                    <th className="pb-3 font-normal">Agent</th>
                    <th className="pb-3 text-right font-normal">Missions</th>
                    <th className="pb-3 pl-6 font-normal">Success rate</th>
                    <th className="pb-3 text-right font-normal">Avg. time</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.agents.map((agent) => {
                    const manifest = manifestOf(agent.templateId);
                    const rate = agent.successRate === null ? null : Math.round(agent.successRate * 100);
                    return (
                      <tr key={agent.templateId} className="border-t border-border">
                        <td className="py-3 pr-4">
                          <Link
                            href={`${projectPath}/agents/${encodeURIComponent(agent.templateId)}`}
                            className="flex items-center gap-3 text-base font-medium text-foreground hover:underline"
                          >
                            <AgentAvatar
                              name={agentName(agent.templateId)}
                              category={manifest?.category}
                              className="size-9 rounded-lg text-sm sm:size-9 sm:rounded-lg sm:text-sm"
                            />
                            <span className="truncate">{agentName(agent.templateId)}</span>
                          </Link>
                        </td>
                        <td className="py-3 text-right text-base tabular-nums text-foreground">{agent.missions}</td>
                        <td className="py-3 pl-6">
                          {rate === null ? (
                            <span className="text-sm text-muted-foreground">No result yet</span>
                          ) : (
                            <div className="flex items-center gap-3">
                              <span className="w-10 text-base tabular-nums text-foreground">{rate}%</span>
                              <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                                <span
                                  className={cn(
                                    "block h-full rounded-full",
                                    rate >= 80 ? "bg-tone-green" : rate >= 50 ? "bg-status-warning" : "bg-status-error",
                                  )}
                                  style={{ width: `${rate}%` }}
                                />
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="py-3 text-right text-base tabular-nums text-muted-foreground">
                          {formatDuration(agent.avgRunMs)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="gap-4 py-6">
          <PanelTitle href={`${projectPath}/missions`}>Recent activity</PanelTitle>
          {overview.recent.length === 0 ? (
            <p className="m-0 px-6 text-base text-muted-foreground">No Missions yet.</p>
          ) : (
            <ul className="m-0 grid list-none p-0">
              {overview.recent.map((mission) => {
                const activity = ACTIVITY[mission.status] ?? ACTIVITY.todo;
                const Icon = activity.icon;
                const label = mission.summary ?? mission.name ?? titleCase(mission.type);
                return (
                  <li key={mission._id} className="border-t border-border first:border-t-0">
                    <Link
                      href={`${projectPath}/missions/${mission._id}`}
                      className="flex items-center gap-4 px-6 py-3 transition-colors hover:bg-accent/50"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex size-10 shrink-0 items-center justify-center rounded-full",
                          GROUP_TILE[activity.group],
                        )}
                      >
                        <Icon className="size-5" />
                      </span>
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="truncate text-base font-medium text-foreground">{activity.title}</span>
                        <span className="truncate text-sm text-muted-foreground">
                          {agentName(mission.templateId)} · {label}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                        {relativeTime(mission.updatedAt)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
