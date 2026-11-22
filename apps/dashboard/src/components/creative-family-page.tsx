"use client";

import { use } from "react";
import Link from "next/link";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ArrowLeft, ExternalLink, Layers, Eye, TrendingUp, Trophy } from "lucide-react";
import { PageHeader } from "@/components/opengroow/page-header";
import { StatTile } from "@/components/opengroow/stat-tile";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EditFamilyButton } from "@/src/components/creative-family-actions";
import { CreativeFamilyArchiveButton } from "@/src/components/creative-family-archive-button";
import { formatSourceDate } from "@/src/components/source-status-pill";
import { FormatBadge, SourceThumbnail, useSourcePlatforms, useThumbnailRequests, type SourcePlatform } from "@/src/components/source-visuals";
import { metricsOf, postUrlOf } from "@/src/lib/creative-library";
import { isWebUrl } from "@/src/lib/web-url";
import { AddSourceButton, RemoveFromFamilyButton } from "@/src/components/creative-family-source-actions";

// One Creative Family (ADR-082): its mechanic, its statistics over external
// views, and its Sources.

const PAGE_SIZE = 25;
// Matches the server's `STATS_SOURCE_CAP` (`creative_families.stats`).
const STATS_CAP = 500;

type FamilyDetail = { _id: string; name: string; description: string; status: "active" | "archived" };
type FamilyStats = { sourceCount: number; withViewsCount: number; medianViews: number | null; maxViews: number | null; truncated: boolean };
type FamilySource = {
  _id: string;
  templateId: string;
  sourceId: string;
  label: string;
  family: string;
  origin: string;
  createdAt: number;
  marketing: { summary?: string };
  analysis?: unknown;
  thumbnailUrl?: string | null;
  thumbnailTriedAt?: number;
};

const number = (value: number): string => new Intl.NumberFormat("en-US").format(value);
/** A figure the server could not compute is unknown, never zero. */
const figure = (value: number | null): string => (value === null ? "Unknown" : number(value));

type Props = { params: Promise<{ projectId: string; familyId: string }> };

export function CreativeFamilyPage({ params }: Props) {
  const { projectId, familyId } = use(params);
  return <CreativeFamilyContent instanceId={decodeURIComponent(projectId)} familyId={decodeURIComponent(familyId)} />;
}

export function CreativeFamilyContent({ instanceId, familyId }: { instanceId: string; familyId: string }) {
  const id = familyId as Id<"creativeFamilies">;
  const family = useQuery(api.creative_families.get, { instanceId, familyId: id }) as FamilyDetail | null | undefined;
  const stats = useQuery(api.creative_families.stats, { instanceId, familyId: id }) as FamilyStats | null | undefined;
  const { results, status, loadMore } = usePaginatedQuery(
    api.creative_families.listSources,
    { instanceId, familyId: id },
    { initialNumItems: PAGE_SIZE },
  ) as { results: FamilySource[]; status: string; loadMore: (numItems: number) => void };
  const platformFor = useSourcePlatforms(instanceId);
  useThumbnailRequests(instanceId, results);

  if (family === undefined) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (family === null) {
    return (
      <div className="grid gap-4">
        <BackLink instanceId={instanceId} />
        <p className="text-sm text-muted-foreground">Creative Family not found.</p>
      </div>
    );
  }
  const hasMore = status === "CanLoadMore" || status === "LoadingMore";
  return (
    <div className="grid gap-8">
      <div className="grid gap-4">
        <BackLink instanceId={instanceId} />
        <PageHeader
          title={family.name}
          description={family.description}
          action={
            <div className="flex items-center gap-3">
              <StatusBadge size="default" tone={family.status === "archived" ? "neutral" : "active"} label={family.status === "archived" ? "Archived" : "Active"} />
              <EditFamilyButton instanceId={instanceId} family={family} />
              {family.status === "archived" ? null : <AddSourceButton instanceId={instanceId} familyId={familyId} />}
              <CreativeFamilyArchiveButton instanceId={instanceId} familyId={family._id} archived={family.status === "archived"} />
            </div>
          }
        />
      </div>

      {stats ? <Statistics stats={stats} /> : null}

      <section aria-label="Family Sources" className="grid gap-3">
        {status === "LoadingFirstPage" ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : results.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Sources in this family.</p>
        ) : (
          <ul className="grid gap-3">
            {results.map((source) => (
              <FamilySourceRow key={source._id} source={source} instanceId={instanceId} platform={platformFor(source)} />
            ))}
          </ul>
        )}
        {hasMore ? (
          <Button type="button" variant="outline" className="w-fit" disabled={status === "LoadingMore"} onClick={() => loadMore(PAGE_SIZE)}>
            Load more
          </Button>
        ) : null}
      </section>
    </div>
  );
}

function BackLink({ instanceId }: { instanceId: string }) {
  return (
    <Link
      href={`/projects/${encodeURIComponent(instanceId)}/library`}
      className="flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      Creative Library
    </Link>
  );
}

function Statistics({ stats }: { stats: FamilyStats }) {
  return (
    <section aria-label="Statistics" className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile icon={Layers} label="Sources with views" value={`${stats.withViewsCount} of ${stats.sourceCount}`} tone="visual" />
        <StatTile icon={TrendingUp} label="Median views" value={figure(stats.medianViews)} tone="engagement" />
        <StatTile icon={Trophy} label="Maximum views" value={figure(stats.maxViews)} tone="research" />
      </div>
      {stats.truncated ? (
        <p role="note" className="m-0 flex items-center gap-2 text-sm text-muted-foreground">
          <Eye aria-hidden="true" className="size-4 shrink-0" />
          These figures cover only the first {STATS_CAP} Sources of the family, not all of them.
        </p>
      ) : null}
    </section>
  );
}

function FamilySourceRow({ source, instanceId, platform }: { source: FamilySource; instanceId: string; platform?: SourcePlatform }) {
  const title = source.marketing.summary ?? source.origin;
  const original = postUrlOf(source);
  return (
    <li>
      <Card className="relative flex flex-col gap-4 px-5 py-3 transition-colors hover:bg-surface-raised has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <SourceThumbnail source={source} className="size-20" />
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">
            <Link
              href={`/projects/${encodeURIComponent(instanceId)}/sources/${encodeURIComponent(source._id)}`}
              className="w-fit max-w-full truncate text-base font-semibold text-foreground outline-none after:absolute after:inset-0 after:content-['']"
            >
              {title}
            </Link>
            <div className="flex flex-wrap items-center gap-3">
              <FormatBadge source={source} platform={platform} />
              <span className="text-sm text-muted-foreground tabular-nums">{formatSourceDate(source.createdAt)}</span>
            </div>
          </div>
        </div>
        <dl className="m-0 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {metricsOf(source.analysis).map(({ label, value }) => (
            <div key={label} className="grid">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="m-0 text-foreground tabular-nums">{value === null ? "Unknown" : number(value)}</dd>
            </div>
          ))}
        </dl>
        <div className="relative z-10 flex items-start justify-end gap-2">
          {isWebUrl(original) ? (
            <Button variant="outline" size="icon" nativeButton={false} render={<a href={original} target="_blank" rel="noreferrer" aria-label="Open original" />}>
              <ExternalLink />
            </Button>
          ) : null}
          <RemoveFromFamilyButton instanceId={instanceId} sourceId={source._id} />
        </div>
      </Card>
    </li>
  );
}
