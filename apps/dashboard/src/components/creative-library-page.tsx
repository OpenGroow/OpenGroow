"use client";

import { use, useState } from "react";
import { useSelection } from "@/src/hooks/use-selection";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { SearchField } from "@/components/opengroow/filter-bar";
import { PageHeader } from "@/components/opengroow/page-header";
import { CheckSquare, Ellipsis, Images, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";
import { SourceThumbnail, useThumbnailRequests, type VisualSource } from "@/src/components/source-visuals";
import { NewFamilyDialog } from "@/src/components/creative-family-actions";
import { MergeFamiliesDialog } from "@/src/components/merge-family-dialog";
import { isActiveFamily, sourceCountLabel } from "@/src/lib/creative-library";

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

type Sort = "most" | "fewest";

type Props = { params: Promise<{ instanceId: string }> };

export function CreativeLibraryPage({ params }: Props) {
  const { instanceId } = use(params);
  return <CreativeLibraryContent instanceId={decodeURIComponent(instanceId)} />;
}

export function CreativeLibraryContent({ instanceId }: { instanceId: string }) {
  const [sort, setSort] = useState<Sort>("most");
  const [search, setSearch] = useState("");
  const families = useQuery(api.creative_families.list, { instanceId }) as FamilyRow[] | undefined;
  const { selecting, selected, start: startSelecting, stop: stopSelecting, toggle } = useSelection();
  const [merging, setMerging] = useState(false);
  const [creating, setCreating] = useState(false);

  const needle = search.trim().toLowerCase();
  // Archived families (merged away or archived) are not listed.
  const activeFamilies = (families ?? []).filter(isActiveFamily);
  const visible = activeFamilies
    .filter((family) => needle === "" || family.name.toLowerCase().includes(needle))
    .sort((a, b) => (sort === "most" ? b.sourceCount - a.sourceCount : a.sourceCount - b.sourceCount));
  const selectedFamilies = activeFamilies.filter((family) => selected.includes(family._id));
  useThumbnailRequests(instanceId, visible.flatMap((family) => family.recentSources));

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Creative Library"
        description="The mechanics your Sources share, grouped into Creative Families."
        action={
          <div className="flex items-center gap-3">
            <Button variant="outline" nativeButton={false} render={<Link href={`/projects/${encodeURIComponent(instanceId)}/library/unclassified`} />}>
              Unclassified Sources
            </Button>
            {selecting ? (
              <>
                <Button type="button" disabled={selectedFamilies.length < 2} onClick={() => setMerging(true)}>
                  Merge ({selectedFamilies.length})
                </Button>
                <Button type="button" variant="outline" onClick={stopSelecting}>
                  Cancel
                </Button>
              </>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="More actions" />}>
                  <Ellipsis />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={startSelecting}>
                    <CheckSquare />
                    Select
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setCreating(true)}>
                    <Plus />
                    New family
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        }
      />
      {families === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : activeFamilies.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Creative Families yet.</p>
      ) : (
        <section className="grid gap-5">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
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
            <p className="text-sm text-muted-foreground">No Creative Families match this search.</p>
          ) : (
            <ul className="grid gap-5 sm:grid-cols-2">
              {visible.map((family) => (
                <FamilyRowItem
                  key={family._id}
                  family={family}
                  instanceId={instanceId}
                  selection={selecting ? { checked: selected.includes(family._id), onToggle: () => toggle(family._id) } : undefined}
                />
              ))}
            </ul>
          )}
        </section>
      )}
      <NewFamilyDialog instanceId={instanceId} open={creating} onOpenChange={setCreating} />
      {merging ? (
        <MergeFamiliesDialog
          instanceId={instanceId}
          families={selectedFamilies}
          onClose={() => setMerging(false)}
          onDone={stopSelecting}
        />
      ) : null}
    </div>
  );
}

/** The three most recent Sources as a mosaic: one large tile on the left, two stacked on the right. */
function FamilyMosaic({ family }: { family: FamilyRow }) {
  const [main, top, bottom] = family.recentSources;
  const tile = (source: VisualSource | undefined, className: string) =>
    source ? (
      <div className={`overflow-hidden ${className}`}>
        <SourceThumbnail source={source} className="size-full rounded-none" />
      </div>
    ) : (
      <div aria-hidden="true" className={`bg-muted ${className}`} />
    );
  return (
    <div className="relative grid aspect-[16/10] grid-cols-[2fr_1fr] grid-rows-2 gap-0.5 overflow-hidden rounded-2xl bg-border">
      {tile(main, "row-span-2")}
      {tile(top, "")}
      {tile(bottom, "")}
      <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold text-white tabular-nums">
        <Images aria-hidden="true" className="size-3.5" />
        {family.sourceCountCapped ? `${family.sourceCount}+` : family.sourceCount}
      </span>
    </div>
  );
}

function FamilyRowItem({
  family,
  instanceId,
  selection,
}: {
  family: FamilyRow;
  instanceId: string;
  selection?: { checked: boolean; onToggle: () => void };
}) {
  return (
    <li>
      <Card className="relative flex flex-col gap-3 p-2 transition-colors hover:bg-surface-raised has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring">
        <FamilyMosaic family={family} />
        {selection ? (
          <Checkbox
            className="absolute left-4 top-4 z-10 bg-background"
            aria-label={`Select ${family.name}`}
            checked={selection.checked}
            onCheckedChange={selection.onToggle}
          />
        ) : null}
        <div className="grid min-w-0 gap-0.5 px-3 pb-3">
          <Link
            data-family-name
            href={`/projects/${encodeURIComponent(instanceId)}/library/${encodeURIComponent(family._id)}`}
            className="max-w-full truncate text-lg font-semibold text-foreground outline-none after:absolute after:inset-0 after:content-['']"
          >
            {family.name}
          </Link>
          <p className="m-0 truncate text-sm text-muted-foreground">
            {sourceCountLabel(family)}
            {family.description ? ` · ${family.description}` : ""}
          </p>
        </div>
      </Card>
    </li>
  );
}
