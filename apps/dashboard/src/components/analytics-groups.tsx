"use client";

import { useState } from "react";
import { ArrowRight, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PlatformLogo, platformName } from "@/src/components/platform-logo";
import { formatValue, type MetricDecl } from "@/src/lib/analytics-figures";

// The Recipes and Families views of the Analytics page (ADR-084): one row per group, read for one Analytics
// Adapter. A row is concise (Publications, how many are measured, last published); the figures sit in the
// expanded row, platform by platform: nothing is added up across platforms or adapters. Marketing performance
// only: no Mission, Run or usage figure, and a recipe with no Publication is not a group.

export type MetricStats = { observations: number; sum?: number; mean?: number; median?: number; recomputed?: number; meanOfRatios?: number; medianOfRatios?: number };
export type PlatformReading = { platform: string; publisherAdapter?: string; publications: number; measured: number; metrics: Record<string, MetricStats> };
export type AdapterReading = { adapter: string; publications: number; measured: number; freshness?: { oldestReadingAt: number; newestReadingAt: number }; platforms: PlatformReading[] };
export type PerformanceGroup = { publications: number; lastPublishedAt: number; adapters: AdapterReading[] };
export type RecipeGroup = PerformanceGroup & { recipeId: string; recipeName: string; archived: boolean; versions: Array<{ version: number; publications: number }> };
export type FamilyGroup = PerformanceGroup & { familyId: string; familyName: string; archived: boolean; recipes: Array<{ recipeId: string; recipeName: string; adapters: AdapterReading[] }> };

const day = (at: number) => new Date(at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const COLUMN = "py-2 text-right font-normal tabular-nums";

/** One platform's figures as a table: a metric the Publications do not report is absent, never zero. */
function PlatformFigures({ reading, metrics }: { reading: PlatformReading; metrics: MetricDecl[] }) {
  const reported = metrics.filter((m) => reading.metrics[m.key]);
  const hasRatio = reported.some((m) => reading.metrics[m.key].recomputed !== undefined);
  return (
    <section aria-label={`${platformName(reading.platform)} figures`} className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="m-0 flex items-center gap-2 text-base font-medium">
          <PlatformLogo service={reading.platform} adapter={reading.publisherAdapter} className="size-5" />
          {platformName(reading.platform)}
        </h4>
        <span className="text-sm text-muted-foreground">
          {reading.measured}/{reading.publications} measured
        </span>
      </div>
      {reported.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">No readings yet.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th scope="col" className="py-2 text-left font-normal">Metric</th>
              <th scope="col" className={COLUMN}>Total</th>
              <th scope="col" className={COLUMN}>Average</th>
              <th scope="col" className={COLUMN}>Median</th>
            </tr>
          </thead>
          <tbody>
            {reported.map((metric) => {
              const stats = reading.metrics[metric.key];
              const fmt = (v: number | undefined) => formatValue(metric, v);
              const ratio = stats.recomputed !== undefined;
              return (
                <tr key={metric.key} className="border-b border-border last:border-0">
                  <th scope="row" className="py-2 text-left font-normal">
                    {metric.label}
                    {stats.observations < reading.publications ? <span className="ml-2 text-xs text-muted-foreground">{stats.observations}/{reading.publications} reported</span> : null}
                  </th>
                  <td className={COLUMN} title={ratio ? "Recomputed from the sums" : undefined}>
                    {fmt(ratio ? stats.recomputed : stats.sum)}
                  </td>
                  <td className={COLUMN} title={ratio ? "Mean of the Publications' own ratios" : undefined}>
                    {fmt(ratio ? stats.meanOfRatios : stats.mean)}
                  </td>
                  <td className={COLUMN} title={ratio ? "Median of the Publications' own ratios" : undefined}>
                    {fmt(ratio ? stats.medianOfRatios : stats.median)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {hasRatio ? <p className="m-0 text-xs text-muted-foreground">Ratios: Total is recomputed from the sums; Average and Median are taken over each Publication's own ratio.</p> : null}
    </section>
  );
}

function GroupRow({
  name,
  badges,
  subtitle,
  adapter,
  metrics,
  onShowPublications,
}: {
  name: string;
  badges: string[];
  subtitle: string;
  adapter: AdapterReading;
  metrics: MetricDecl[];
  onShowPublications: () => void;
}) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <li>
      <Card className="gap-0 p-0">
        <Button type="button" variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="h-auto w-full items-start justify-between gap-4 rounded-b-none px-5 py-4 text-left font-normal whitespace-normal hover:bg-transparent">
          <span className="grid min-w-0 gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold">{name}</span>
              {badges.map((b) => (
                <Badge key={b} variant="outline">
                  {b}
                </Badge>
              ))}
            </span>
            <span className="text-sm text-muted-foreground">{subtitle}</span>
          </span>
          <Chevron aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" />
        </Button>
        {open ? (
          <div className="grid gap-6 border-t border-border px-5 py-4">
            {adapter.platforms.map((p) => (
              <PlatformFigures key={p.platform} reading={p} metrics={metrics} />
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">
                {adapter.freshness ? `Updated ${day(adapter.freshness.newestReadingAt)}` : "No Publication measured yet"}
              </span>
              <Button type="button" variant="link" className="h-auto p-0" onClick={onShowPublications}>
                View publications <ArrowRight aria-hidden="true" className="size-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </li>
  );
}

const readingOf = (group: { adapters: AdapterReading[] }, adapterId: string) => group.adapters.find((a) => a.adapter === adapterId);

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
            subtitle={`${plural(adapter.publications, "publication")} · ${plural(group.versions.length, "version")}`}
            adapter={adapter}
            metrics={metrics}
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
            subtitle={`${plural(adapter.publications, "publication")} · ${plural(group.recipes.filter((r) => readingOf(r, adapterId)).length, "recipe")}`}
            adapter={adapter}
            metrics={metrics}
            onShowPublications={() => onShowPublications(group.familyId)}
          />,
        ];
      })}
    </ul>
  );
}
