"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { SearchField } from "@/components/opengroow/filter-bar";
import { PageHeader } from "@/components/opengroow/page-header";
import { CheckSquare, Ellipsis, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLinkItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";
import { SourceThumbnail, useThumbnailRequests, type VisualSource } from "@/src/components/source-visuals";
import { NewFamilyButton } from "@/src/components/creative-family-actions";
import { MergeFamiliesDialog } from "@/src/components/merge-family-dialog";
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
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [merging, setMerging] = useState(false);
  const toggle = (id: string) => setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const stopSelecting = () => {
    setSelecting(false);
    setSelected([]);
  };

  const needle = search.trim().toLowerCase();
  // Archived families (merged away or archived) are not listed.
  const activeFamilies = (families ?? []).filter((family) => family.status === "active");
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
                  <DropdownMenuItem onClick={() => setSelecting(true)}>
                    <CheckSquare />
                    Select
                  </DropdownMenuItem>
                  <DropdownMenuLinkItem render={<Link href={`/projects/${encodeURIComponent(instanceId)}/library/unclassified`} />}>
                    <Inbox />
                    Unclassified Sources
                  </DropdownMenuLinkItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <NewFamilyButton instanceId={instanceId} />
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
            <ul className="grid gap-3">
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
      <Card className="relative flex flex-col gap-4 px-5 py-4 transition-colors hover:bg-surface-raised has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring lg:flex-row lg:items-center">
        {selection ? (
          <Checkbox
            className="relative z-10"
            aria-label={`Select ${family.name}`}
            checked={selection.checked}
            onCheckedChange={selection.onToggle}
          />
        ) : null}
        <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              data-family-name
              href={`/projects/${encodeURIComponent(instanceId)}/library/${encodeURIComponent(family._id)}`}
              className="max-w-full truncate text-base font-semibold text-foreground outline-none after:absolute after:inset-0 after:content-['']"
            >
              {family.name}
            </Link>
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
