"use client";

import { useUrlTab } from "@/src/lib/use-url-tab";
import { use, useState } from "react";
import Link from "next/link";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { Ban, CircleCheck, CircleX, ExternalLink, Layers, ListChecks, LoaderCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { formatSourceDate, SourcePipelinePill } from "@/src/components/source-status-pill";
import { deriveSourcePipelineState } from "@/src/lib/source-pipeline";
import { isWebUrl } from "@/src/lib/web-url";
import { PageHeader } from "@/components/opengroow/page-header";
import { FilterChips, SearchField } from "@/components/opengroow/filter-bar";
import { StatTile } from "@/components/opengroow/stat-tile";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { sourceScore } from "@/src/lib/source-score";
import { FormatBadge, NotScoredHint, SourceThumbnail, useSourcePlatforms, useThumbnailRequests, type SourcePlatform } from "@/src/components/source-visuals";
import { agentLabel } from "@/src/lib/mission-type";
import { cn } from "@/lib/utils";

// Matches the server's `COUNT_CAP` (`sources.counts`): a status with that many Sources shows "5000+".
const COUNT_CAP = 5000;

type Props = {
  params: Promise<{ instanceId: string }>;
};

export function InstanceSourcesPage({ params }: Props) {
  const { instanceId } = use(params);
  return <InstanceSourcesContent instanceId={decodeURIComponent(instanceId)} />;
}

// `_id` stays a plain string so fixtures stay lightweight.
type SourceRow = Pick<
  Doc<"sources">,
  | "label"
  | "family"
  | "status"
  | "origin"
  | "templateId"
  | "createdAt"
  | "marketing"
  | "scoring"
  | "excluded"
  | "sourceId"
  | "analysis"
  | "thumbnailTriedAt"
> & { _id: string; thumbnailUrl?: string | null };

const PAGE_SIZE = 50;

// The toolbar of both tabs shares these, so it does not shift when switching tabs.
const TOOLBAR_ROW = "flex flex-col justify-between gap-4 lg:flex-row lg:items-center";
const TOOLBAR_SEARCH = "lg:w-52";
const TOOLBAR_SELECT = "h-11 sm:w-40";

// The Scored tab lists the Sources the pipeline calls Scored: analysed and scored.
const READY_TAB_STAGE = "Scored";

// The Status of a Source is its pipeline stage, derived from the Source facts
// (`deriveSourcePipelineState`), never stored, so no index serves the filter
// and it works on the loaded rows. A Scored Source is on the Scored tab and is not
// listed in Other. Nothing sets `excluded` any more.
const STATUS_FILTERS = [
  { id: "processing", label: "Processing", stages: ["Ingestion"] },
  { id: "not-scored", label: "Not scored yet", stages: ["Ready"] },
  { id: "failed", label: "Failed", stages: ["Failed", "Unavailable"] },
] as const;

function matchesStatus(source: SourceRow, filter: string): boolean {
  if (filter === "all") return true;
  const stages: readonly string[] = STATUS_FILTERS.find((entry) => entry.id === filter)?.stages ?? [];
  return stages.includes(stageOf(source));
}

function stageOf(source: SourceRow): string {
  const state = deriveSourcePipelineState(source);
  return state.kind === "stage" ? state.current : state.label;
}

export function InstanceSourcesContent({ instanceId }: { instanceId: string }) {
  const [stage, setStage] = useState("all");
  const [agent, setAgent] = useState("all");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useUrlTab<"ready" | "other">(["ready", "other"], "ready");
  const {
    results: sources,
    status,
    loadMore,
  } = usePaginatedQuery(
    api.sources.listByInstance,
    { instanceId },
    { initialNumItems: PAGE_SIZE },
  ) as { results: SourceRow[]; status: string; loadMore: (numItems: number) => void };

  const needle = search.trim().toLowerCase();
  const others = sources.filter((source) => stageOf(source) !== READY_TAB_STAGE);
  const visible = others.filter(
    (source) =>
      matchesStatus(source, stage) &&
      (agent === "all" || source.templateId === agent) &&
      (needle === "" || `${source.marketing.summary ?? ""} ${source.origin}`.toLowerCase().includes(needle)),
  );
  const count = (predicate: (source: SourceRow) => boolean) => sources.filter(predicate).length;
  // The real numbers, from the server: the rows loaded so far only count what "Load more" has fetched.
  // Until they arrive, the loaded rows stand in.
  const serverCounts = useQuery(api.sources.counts, { instanceId });
  const totals = serverCounts;
  const shown = (value: number | undefined, fallback: number): number | string =>
    value === undefined ? fallback : totals?.capped && value >= COUNT_CAP ? `${value}+` : value;
  const agents = [...new Set(others.map((source) => source.templateId))].sort();
  const hasMore = status === "CanLoadMore" || status === "LoadingMore";
  const selection = useSourceSelection(visible);
  const tabs = (
    <div className="shrink-0">
      <FilterChips
        label="Sources view"
        value={tab}
        onChange={(id) => setTab(id === "other" ? "other" : "ready")}
        options={[
          { id: "ready", label: "Scored", count: totals?.scored ?? count((source) => stageOf(source) === READY_TAB_STAGE) },
          { id: "other", label: "Other", count: totals?.other ?? others.length },
        ]}
      />
    </div>
  );
  useThumbnailRequests(instanceId, tab === "other" ? visible : []);
  const platformFor = useSourcePlatforms(instanceId);

  return (
    <div className="grid gap-8">
      <PageHeader title="Sources" description="What your agents spotted out there: social posts, keywords and other signals, scored for inspiration." />

      {status === "LoadingFirstPage" ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Sources yet.</p>
      ) : (
        <>
          {/* The server's real counts; until they arrive, the loaded rows stand in
              and the first tile says "Loaded" while more pages remain. */}
          <section aria-label="Source counts" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatTile icon={Layers} label={totals || !hasMore ? "Total sources" : "Loaded sources"} value={shown(totals?.total, sources.length)} tone="visual" />
            <StatTile icon={LoaderCircle} label="Processing" value={shown(totals?.processing, count((s) => s.status === "processing"))} tone="research" />
            <StatTile icon={CircleCheck} label="Ready" value={shown(totals?.ready, count((s) => s.status === "ready"))} tone="engagement" />
            <StatTile icon={CircleX} label="Failed" value={shown(totals?.failed, count((s) => s.status === "failed"))} tone="error" />
            <StatTile icon={Ban} label="Unavailable" value={shown(totals?.unavailable, count((s) => s.status === "unavailable"))} />
          </section>

          {tab === "ready" ? (
            <ReadySources
              tabs={tabs}
              sources={sources}
              instanceId={instanceId}
              hasMore={hasMore}
              loadingMore={status === "LoadingMore"}
              onLoadMore={() => loadMore(PAGE_SIZE)}
            />
          ) : null}

          {tab === "other" ? (
          <section className="grid gap-5">
            <div className={TOOLBAR_ROW}>
              {tabs}
              <div className="flex flex-col gap-3 sm:flex-row">
                <SearchField value={search} onChange={setSearch} label="Search sources" placeholder="Search sources…" className={TOOLBAR_SEARCH} />
                <NativeSelect
                  aria-label="Filter by status"
                  className={TOOLBAR_SELECT}
                  value={stage}
                  onChange={(event) => setStage(event.target.value)}
                >
                  <option value="all">All statuses</option>
                  {STATUS_FILTERS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
                <NativeSelect
                  aria-label="Filter by agent"
                  className={TOOLBAR_SELECT}
                  value={agent}
                  onChange={(event) => setAgent(event.target.value)}
                >
                  <option value="all">All agents</option>
                  {agents.map((templateId) => (
                    <option key={templateId} value={templateId}>
                      {agentLabel(templateId)}
                    </option>
                  ))}
                </NativeSelect>
                <SelectButton selection={selection} />
              </div>
            </div>

            <SelectionBar selection={selection} />

            {visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">No Sources match these filters.</p>
            ) : (
              <ul className={GALLERY}>
                {visible.map((source) => (
                  <SourceCard
                    key={source._id}
                    source={source}
                    instanceId={instanceId}
                    platform={platformFor(source)}
                    selecting={selection.selecting}
                    selected={selection.selected.has(source._id)}
                    onToggle={() => selection.toggleOne(source._id)}
                    showStatus
                  />
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="m-0 text-sm text-muted-foreground">
                Showing {visible.length} of {sources.length} {hasMore ? "loaded " : ""}sources
              </p>
              {hasMore ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={status === "LoadingMore"}
                  onClick={() => loadMore(PAGE_SIZE)}
                >
                  Load more
                </Button>
              ) : null}
            </div>
          </section>
          ) : null}
        </>
      )}

      <DeleteSourcesDialog selection={selection} />
    </div>
  );
}

/** Select mode: checkboxes on every row, then one permanent deletion. Shared by
 * the Scored and Other tabs; `visible` is the list on screen. */
function useSourceSelection(visible: SourceRow[]) {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const removeMany = useMutation(api.sources.removeMany);
  // Only what is on screen can be deleted: a filter never hides a selected row from the count.
  const selectedVisible = visible.filter((source) => selected.has(source._id));
  const allVisibleSelected = visible.length > 0 && selectedVisible.length === visible.length;

  return {
    selecting,
    selected,
    selectedVisible,
    allVisibleSelected,
    confirming,
    deleting,
    deleteError,
    setConfirming,
    toggleSelecting(): void {
      setSelecting((on) => !on);
      setSelected(new Set());
      setDeleteError(null);
    },
    toggleOne(id: string): void {
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    toggleAllVisible(): void {
      setSelected(allVisibleSelected ? new Set() : new Set(visible.map((source) => source._id)));
    },
    askToDelete(): void {
      setDeleteError(null);
      setConfirming(true);
    },
    async deleteSelected(): Promise<void> {
      setDeleting(true);
      setDeleteError(null);
      try {
        const ids = selectedVisible.map((source) => source._id as Id<"sources">);
        // One call per chunk: the server caps how many Sources a single deletion takes.
        for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
          await removeMany({ sourceIds: ids.slice(i, i + DELETE_CHUNK) });
        }
        setConfirming(false);
        setSelected(new Set());
        setSelecting(false);
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : "Could not delete the Sources.");
      } finally {
        setDeleting(false);
      }
    },
  };
}

type SourceSelection = ReturnType<typeof useSourceSelection>;

function SelectButton({ selection }: { selection: SourceSelection }) {
  return (
    <Button type="button" variant={selection.selecting ? "secondary" : "outline"} className="h-11" onClick={selection.toggleSelecting}>
      <ListChecks />
      {selection.selecting ? "Done" : "Select"}
    </Button>
  );
}

function SelectionBar({ selection }: { selection: SourceSelection }) {
  const { selectedVisible, allVisibleSelected } = selection;
  if (!selection.selecting) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-3">
      <label className="flex items-center gap-3 text-sm text-foreground">
        <Checkbox
          checked={allVisibleSelected}
          indeterminate={selectedVisible.length > 0 && !allVisibleSelected}
          onCheckedChange={selection.toggleAllVisible}
          aria-label="Select all shown sources"
        />
        {selectedVisible.length === 0 ? "Select all shown" : `${selectedVisible.length} selected`}
      </label>
      <Button type="button" variant="destructive" disabled={selectedVisible.length === 0} onClick={selection.askToDelete}>
        <Trash2 />
        Delete{selectedVisible.length > 0 ? ` (${selectedVisible.length})` : ""}
      </Button>
    </div>
  );
}

function DeleteSourcesDialog({ selection }: { selection: SourceSelection }) {
  const { selectedVisible, deleting, deleteError } = selection;
  return (
    <Dialog
      open={selection.confirming}
      onOpenChange={(open) => {
        if (!deleting) selection.setConfirming(open);
      }}
      disablePointerDismissal={deleting}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Delete {selectedVisible.length} {selectedVisible.length === 1 ? "Source" : "Sources"}?
          </DialogTitle>
          <DialogDescription>
            This is permanent. Missions already created from these Sources are kept. The same post can show up again as a
            new Source if an Agent captures it again.
          </DialogDescription>
        </DialogHeader>
        {deleteError ? (
          <p role="alert" className="m-0 rounded-xl bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive">
            {deleteError}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={deleting} onClick={() => selection.setConfirming(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={deleting} onClick={() => void selection.deleteSelected()}>
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Matches the server's `MAX_SOURCES_PER_REMOVAL`. */
const DELETE_CHUNK = 100;

const GALLERY = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

/**
 * A Source in the gallery: its image, with the format and the score over it, and its title below. `showStatus`
 * (the Other tab) adds the pipeline status, the Agent and the date, since those Sources are not scored yet.
 */
function SourceCard({
  source,
  instanceId,
  platform,
  selecting,
  selected,
  onToggle,
  showStatus = false,
}: {
  source: SourceRow;
  instanceId: string;
  platform?: SourcePlatform;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  showStatus?: boolean;
}) {
  // What the Source teaches is the most readable title; the origin is the fallback.
  const title = source.marketing.summary ?? source.origin;
  const score = sourceScore(source.scoring);
  return (
    <li>
      <Card
        className={cn(
          "relative flex h-full cursor-pointer flex-col gap-3 p-2 transition-colors hover:bg-surface-raised has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring",
          selected && "ring-2 ring-primary",
        )}
      >
        <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-muted">
          <SourceThumbnail source={source} className="size-full rounded-none" />
          {selecting ? (
            <div className="absolute left-2 top-2 z-10 rounded bg-background/90 p-1">
              <Checkbox checked={selected} onCheckedChange={onToggle} aria-label={`Select ${title}`} />
            </div>
          ) : null}
          <div className="absolute bottom-2 left-2 right-2 flex items-end justify-between gap-2">
            <FormatBadge source={source} platform={platform} />
            {score !== undefined ? <Badge variant="outline" className="bg-background/90 tabular-nums">Score {score}</Badge> : null}
          </div>
          {isWebUrl(source.origin) ? (
            <Button
              variant="outline"
              size="icon"
              className="absolute right-2 top-2 z-10 size-8 bg-background/90"
              nativeButton={false}
              render={<a href={source.origin} target="_blank" rel="noreferrer" aria-label="Open original" />}
            >
              <ExternalLink />
            </Button>
          ) : null}
        </div>
        <div className="grid min-w-0 gap-1 px-1 pb-1">
          <Link
            href={`/projects/${encodeURIComponent(instanceId)}/sources/${encodeURIComponent(source._id)}`}
            title={title}
            className="m-0 line-clamp-2 text-sm font-semibold text-foreground outline-none after:absolute after:inset-0 after:content-['']"
            onClick={(event) => {
              // In select mode the whole card toggles; it never opens the Source.
              if (!selecting) return;
              event.preventDefault();
              onToggle();
            }}
          >
            {title}
          </Link>
          {showStatus ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <SourcePipelinePill source={source} />
              {stageOf(source) === "Ready" ? <NotScoredHint /> : null}
              <span className="truncate">{agentLabel(source.templateId)}</span>
              <span className="tabular-nums">{formatSourceDate(source.createdAt)}</span>
            </div>
          ) : null}
        </div>
      </Card>
    </li>
  );
}

type ReadySort = "score" | "newest";

function ReadySources({ tabs, sources, instanceId, hasMore, loadingMore, onLoadMore }: {
  tabs: React.ReactNode;
  sources: SourceRow[];
  instanceId: string;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const [sort, setSort] = useState<ReadySort>("score");
  const [agent, setAgent] = useState("all");
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const ready = sources
    .filter((source) => stageOf(source) === READY_TAB_STAGE)
    .filter((source) => agent === "all" || source.templateId === agent)
    .filter((source) => needle === "" || `${source.marketing.summary ?? ""} ${source.origin}`.toLowerCase().includes(needle))
    .sort((a, b) => (sort === "score" ? (sourceScore(b.scoring) ?? -1) - (sourceScore(a.scoring) ?? -1) : b.createdAt - a.createdAt));
  const agents = [...new Set(sources.filter((source) => stageOf(source) === READY_TAB_STAGE).map((source) => source.templateId))].sort();
  const selection = useSourceSelection(ready);
  useThumbnailRequests(instanceId, ready);
  const platformFor = useSourcePlatforms(instanceId);

  return (
    <section aria-label="Ready sources" className="grid gap-5">
      <div className={TOOLBAR_ROW}>
        {tabs}
        <div className="flex flex-col gap-3 sm:flex-row">
          <SearchField value={search} onChange={setSearch} label="Search ready sources" placeholder="Search sources…" className={TOOLBAR_SEARCH} />
          <NativeSelect aria-label="Sort ready sources" className={TOOLBAR_SELECT} value={sort} onChange={(event) => setSort(event.target.value === "newest" ? "newest" : "score")}>
            <option value="score">Highest score</option>
            <option value="newest">Newest first</option>
          </NativeSelect>
          <NativeSelect aria-label="Filter ready sources by agent" className={TOOLBAR_SELECT} value={agent} onChange={(event) => setAgent(event.target.value)}>
            <option value="all">All agents</option>
            {agents.map((templateId) => (
              <option key={templateId} value={templateId}>{agentLabel(templateId)}</option>
            ))}
          </NativeSelect>
          <SelectButton selection={selection} />
        </div>
      </div>

      <SelectionBar selection={selection} />

      {ready.length === 0 ? (
        <p className="text-sm text-muted-foreground">No scored Sources yet.</p>
      ) : (
        <ul className={GALLERY}>
            {ready.map((source) => (
              <SourceCard
                key={source._id}
                source={source}
                instanceId={instanceId}
                platform={platformFor(source)}
                selecting={selection.selecting}
                selected={selection.selected.has(source._id)}
                onToggle={() => selection.toggleOne(source._id)}
              />
            ))}
          </ul>
      )}

      {hasMore ? (
        <div className="flex justify-end">
          <Button type="button" variant="outline" disabled={loadingMore} onClick={onLoadMore}>
            Load more
          </Button>
        </div>
      ) : null}

      <DeleteSourcesDialog selection={selection} />
    </section>
  );
}
