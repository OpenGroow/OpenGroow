"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { FilterChips, SearchField } from "@/components/opengroow/filter-bar";
import { PageHeader } from "@/components/opengroow/page-header";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { SourceThumbnail, useThumbnailRequests, type VisualSource } from "@/src/components/source-visuals";
import { sourceCountLabel } from "@/src/lib/creative-library";

// The Project's Creative Families (ADR-082): a list the user curates, each with
// the mechanic its Sources share. Read-only here; built from the Sources page blocks.

type FamilyRow = {
  _id: string;
  name: string;
  description: string;
  status: "active" | "archived";
  sourceCount: number;
  sourceCountCapped: boolean;
  recentSources: VisualSource[];
};

type StatusFilter = "all" | "active" | "archived" | "empty";
type Sort = "most" | "fewest";

const matchesFilter = (family: FamilyRow, filter: StatusFilter): boolean =>
  filter === "all" ||
  (filter === "empty" ? family.sourceCount === 0 : family.status === filter);

type Props = { params: Promise<{ instanceId: string }> };

export function CreativeLibraryPage({ params }: Props) {
  const { instanceId } = use(params);
  return <CreativeLibraryContent instanceId={decodeURIComponent(instanceId)} />;
}

export function CreativeLibraryContent({ instanceId }: { instanceId: string }) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<Sort>("most");
  const [search, setSearch] = useState("");
  const families = useQuery(api.creative_families.list, { instanceId }) as FamilyRow[] | undefined;

  const needle = search.trim().toLowerCase();
  const visible = (families ?? [])
    .filter((family) => matchesFilter(family, filter) && (needle === "" || family.name.toLowerCase().includes(needle)))
    .sort((a, b) => (sort === "most" ? b.sourceCount - a.sourceCount : a.sourceCount - b.sourceCount));
  const count = (id: StatusFilter) => (families ?? []).filter((family) => matchesFilter(family, id)).length;
  useThumbnailRequests(instanceId, visible.flatMap((family) => family.recentSources));

  return (
    <div className="grid gap-8">
      <PageHeader title="Creative Library" description="The mechanics your Sources share, grouped into Creative Families."
        action={
          <Button variant="outline" nativeButton={false} render={<Link href={`/projects/${encodeURIComponent(instanceId)}/library/unclassified`} />}>
            Unclassified Sources
          </Button>
        }
      />
      {families === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : families.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Creative Families yet.</p>
      ) : (
        <section className="grid gap-5">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <FilterChips
              label="Family status"
              value={filter}
              onChange={(id) => setFilter(id as StatusFilter)}
              options={[
                { id: "all", label: "All", count: count("all") },
                { id: "active", label: "Active", count: count("active") },
                { id: "archived", label: "Archived", count: count("archived") },
                { id: "empty", label: "Empty", count: count("empty") },
              ]}
            />
            <div className="flex flex-col gap-3 sm:flex-row">
              <SearchField value={search} onChange={setSearch} label="Search families" placeholder="Search families…" className="lg:w-52" />
              <NativeSelect
                aria-label="Sort families"
                className="h-11 sm:w-48"
                value={sort}
                onChange={(event) => setSort(event.target.value === "fewest" ? "fewest" : "most")}
              >
                <option value="most">Most Sources</option>
                <option value="fewest">Fewest Sources</option>
              </NativeSelect>
            </div>
          </div>
          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Creative Families match these filters.</p>
          ) : (
            <ul className="grid gap-3">
              {visible.map((family) => (
                <FamilyRowItem key={family._id} family={family} instanceId={instanceId} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function FamilyRowItem({ family, instanceId }: { family: FamilyRow; instanceId: string }) {
  return (
    <li>
      <Card className="relative flex flex-col gap-4 px-5 py-4 transition-colors hover:bg-surface-raised has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring lg:flex-row lg:items-center">
        <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              data-family-name
              href={`/projects/${encodeURIComponent(instanceId)}/library/${encodeURIComponent(family._id)}`}
              className="max-w-full truncate text-base font-semibold text-foreground outline-none after:absolute after:inset-0 after:content-['']"
            >
              {family.name}
            </Link>
            <StatusBadge tone={family.status === "archived" ? "neutral" : "active"} label={family.status === "archived" ? "Archived" : "Active"} />
            {family.sourceCount === 0 ? <Badge variant="outline" size="xs">Empty</Badge> : null}
            {family.sourceCount === 1 ? <Badge variant="outline" size="xs">Single Source</Badge> : null}
          </div>
          <p className="m-0 line-clamp-2 text-sm text-muted-foreground">{family.description}</p>
        </div>
        <span className="text-sm text-foreground tabular-nums lg:w-28">{sourceCountLabel(family)}</span>
        <div className="flex gap-2 lg:w-44">
          {family.recentSources.map((source) => (
            <SourceThumbnail key={source._id} source={source} className="size-12" />
          ))}
        </div>
      </Card>
    </li>
  );
}
