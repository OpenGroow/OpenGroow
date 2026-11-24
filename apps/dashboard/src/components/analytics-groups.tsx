"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { platformName } from "@/src/components/platform-logo";
import { formatValue, type MetricDecl } from "@/src/lib/analytics-figures";

// The Recipes and Families views of the Analytics page (ADR-084): one row per group, read for one Analytics
// Adapter. A row is concise (Publications, how many are measured, last published); the figures sit in the
// expanded row, platform by platform: nothing is added up across platforms or adapters. Marketing performance
// only: no Mission, Run or usage figure, and a recipe with no Publication is not a group.

export type MetricStats = { observations: number; sum?: number; mean?: number; median?: number; recomputed?: number; meanOfRatios?: number; medianOfRatios?: number };
export type PlatformReading = { platform: string; publications: number; measured: number; metrics: Record<string, MetricStats> };
export type AdapterReading = { adapter: string; publications: number; measured: number; freshness?: { oldestReadingAt: number; newestReadingAt: number }; platforms: PlatformReading[] };
export type PerformanceGroup = { publications: number; lastPublishedAt: number; adapters: AdapterReading[] };
export type RecipeGroup = PerformanceGroup & { recipeId: string; recipeName: string; archived: boolean; versions: Array<{ version: number; publications: number }> };
export type FamilyGroup = PerformanceGroup & { familyId: string; familyName: string; archived: boolean; recipes: Array<{ recipeId: string; recipeName: string; publications: number }> };

const day = (at: number) => new Date(at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The figures of one metric on one platform, each with what it is: a stat is never a bare number. */
function figuresOf(metric: MetricDecl, stats: MetricStats): Array<[string, string]> {
  const fmt = (v: number | undefined) => formatValue(metric, v);
  if (stats.recomputed !== undefined) {
    return [
      ["From the sums", fmt(stats.recomputed)],
      ["Mean of Publications", fmt(stats.meanOfRatios)],
      ["Median of Publications", fmt(stats.medianOfRatios)],
    ];
  }
  return [...(stats.sum !== undefined ? ([["Total", fmt(stats.sum)]] as Array<[string, string]>) : []), ["Mean", fmt(stats.mean)], ["Median", fmt(stats.median)]];
}

function PlatformFigures({ reading, metrics }: { reading: PlatformReading; metrics: MetricDecl[] }) {
  const reported = metrics.filter((m) => reading.metrics[m.key]);
  return (
    <section aria-label={`${platformName(reading.platform)} figures`} className="grid gap-3 rounded-xl border border-border p-4">
      <h4 className="m-0 text-base font-medium">
        {platformName(reading.platform)}
        <span className="ml-2 text-sm font-normal text-muted-foreground">
          {plural(reading.publications, "Publication")}, {reading.measured} measured
        </span>
      </h4>
      {reported.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">No readings yet.</p>
      ) : (
        <dl className="m-0 grid gap-3 sm:grid-cols-2">
          {reported.map((metric) => {
            const stats = reading.metrics[metric.key];
            return (
              <div key={metric.key} className="grid gap-1">
                <dt className="text-sm font-medium">
                  {metric.label}
                  <span className="ml-2 font-normal text-muted-foreground">
                    reported by {stats.observations} of {reading.publications}
                  </span>
                </dt>
                <dd className="m-0 flex flex-wrap gap-x-4 text-sm tabular-nums text-muted-foreground">
                  {figuresOf(metric, stats).map(([label, value]) => (
                    <span key={label}>
                      {label} <span className="text-foreground">{value}</span>
                    </span>
                  ))}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}

function GroupRow({
  name,
  badges,
  group,
  adapter,
  metrics,
  detail,
  onShowPublications,
}: {
  name: string;
  badges: string[];
  group: PerformanceGroup;
  adapter: AdapterReading;
  metrics: MetricDecl[];
  detail: React.ReactNode;
  onShowPublications: () => void;
}) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li>
      <Card className="grid gap-4 p-4">
        <Button type="button" variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="h-auto w-full justify-between gap-4 px-0 py-0 text-left font-normal whitespace-normal hover:bg-transparent">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-medium">{name}</span>
            {badges.map((b) => (
              <Badge key={b} variant="outline">
                {b}
              </Badge>
            ))}
          </span>
          <span className="flex shrink-0 items-center gap-4 text-sm text-muted-foreground">
            <span>{plural(adapter.publications, "Publication")}</span>
            <span>{adapter.measured} measured</span>
            <span className="max-sm:hidden">Last published {day(group.lastPublishedAt)}</span>
            <Chevron aria-hidden="true" className="size-4" />
          </span>
        </Button>
        {open ? (
          <div className="grid gap-4">
            {adapter.freshness ? (
              <p className="m-0 text-sm text-muted-foreground">
                Readings taken {day(adapter.freshness.oldestReadingAt)}
                {adapter.freshness.newestReadingAt !== adapter.freshness.oldestReadingAt ? ` to ${day(adapter.freshness.newestReadingAt)}` : ""}.
              </p>
            ) : (
              <p className="m-0 text-sm text-muted-foreground">No Publication measured yet.</p>
            )}
            {detail}
            <div className="grid gap-3 lg:grid-cols-2">
              {adapter.platforms.map((p) => (
                <PlatformFigures key={p.platform} reading={p} metrics={metrics} />
              ))}
            </div>
            <Button type="button" variant="outline" className="w-fit" onClick={onShowPublications}>
              Show Publications
            </Button>
          </div>
        ) : null}
      </Card>
    </li>
  );
}

const readingOf = (group: PerformanceGroup, adapterId: string) => group.adapters.find((a) => a.adapter === adapterId);

export function RecipeGroups({ groups, adapterId, metrics, onShowPublications }: { groups: RecipeGroup[]; adapterId: string; metrics: MetricDecl[]; onShowPublications: (recipeId: string) => void }) {
  return (
    <ul className="m-0 grid list-none gap-3 p-0" aria-label="Recipes">
      {groups.flatMap((group) => {
        const adapter = readingOf(group, adapterId);
        if (!adapter) return [];
        return [
          <GroupRow
            key={group.recipeId}
            name={group.recipeName}
            badges={group.archived ? ["Archived"] : []}
            group={group}
            adapter={adapter}
            metrics={metrics}
            detail={
              <p className="m-0 text-sm text-muted-foreground">
                Versions published: {group.versions.map((v) => `v${v.version} (${plural(v.publications, "Publication")})`).join(", ")}
              </p>
            }
            onShowPublications={() => onShowPublications(group.recipeId)}
          />,
        ];
      })}
    </ul>
  );
}

export function FamilyGroups({ groups, adapterId, metrics, onShowPublications }: { groups: FamilyGroup[]; adapterId: string; metrics: MetricDecl[]; onShowPublications: (familyId: string) => void }) {
  return (
    <ul className="m-0 grid list-none gap-3 p-0" aria-label="Families">
      {groups.flatMap((group) => {
        const adapter = readingOf(group, adapterId);
        if (!adapter) return [];
        return [
          <GroupRow
            key={group.familyId}
            name={group.familyName}
            badges={group.archived ? ["Archived"] : []}
            group={group}
            adapter={adapter}
            metrics={metrics}
            detail={
              <p className="m-0 text-sm text-muted-foreground">
                Recipes: {group.recipes.map((r) => `${r.recipeName} (${plural(r.publications, "Publication")})`).join(", ")}
              </p>
            }
            onShowPublications={() => onShowPublications(group.familyId)}
          />,
        ];
      })}
    </ul>
  );
}
