"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { Ban, CircleCheck, CircleX, ExternalLink, Layers, ListChecks, LoaderCircle, Music2, Sparkles, Trash2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { formatSourceDate, SourcePipelinePill } from "@/src/components/source-status-pill";
import { deriveSourcePipelineState } from "@/src/lib/source-pipeline";
import { PageHeader } from "@/components/opengroow/page-header";
import { FilterChips, SearchField } from "@/components/opengroow/filter-bar";
import { StatTile } from "@/components/opengroow/stat-tile";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import { cn } from "@/lib/utils";

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
  | "selectedAt"
  | "productionMissionId"
  | "producedAt"
  | "publishedAt"
  | "excluded"
  | "sourceId"
  | "analysis"
  | "routing"
  | "routeTo"
  | "thumbnailTriedAt"
> & { _id: string; thumbnailUrl?: string | null };

const PAGE_SIZE = 50;

// The Ready tab lists the Sources the pipeline calls Scored: analysed, scored
// and not picked for production yet.
const READY_TAB_STAGE = "Scored";

// The Status of a Source is its pipeline stage, derived from the Source facts
// (`deriveSourcePipelineState`), never stored, so no index serves the filter
// and it works on the loaded rows. "Ready" as a filter means every analysed
// Source (Ready up to Published, matching the Ready tile); the exact stages
// stay available in the select.
const READY_ANY = "ready-any";
const READY_STAGES = ["Ready", "Scored", "Routed", "In production", "Produced", "Published"];
const STAGE_LABELS: Record<string, string> = { Ingestion: "Processing", Ready: "Ready (not scored yet)" };
const STATUS_STAGES = ["Ingestion", ...READY_STAGES, "Failed", "Unavailable", "Excluded"];
const STATUS_CHIPS = [
  { id: "all", label: "All" },
  { id: "Ingestion", label: "Processing" },
  { id: READY_ANY, label: "Ready" },
  { id: "Published", label: "Published" },
  { id: "Failed", label: "Failed" },
];

function matchesStage(source: SourceRow, filter: string): boolean {
  const stage = stageOf(source);
  if (filter === "all") return true;
  return filter === READY_ANY ? READY_STAGES.includes(stage) : stage === filter;
}

function stageOf(source: SourceRow): string {
  const state = deriveSourcePipelineState(source);
  return state.kind === "stage" ? state.current : state.label;
}

export function InstanceSourcesContent({ instanceId }: { instanceId: string }) {
  const [stage, setStage] = useState("all");
  const [agent, setAgent] = useState("all");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"ready" | "all">("ready");
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
  const visible = sources.filter(
    (source) =>
      matchesStage(source, stage) &&
      (agent === "all" || source.templateId === agent) &&
      (needle === "" || `${source.marketing.summary ?? ""} ${source.origin}`.toLowerCase().includes(needle)),
  );
  const count = (predicate: (source: SourceRow) => boolean) => sources.filter(predicate).length;
  const agents = [...new Set(sources.map((source) => source.templateId))].sort();
  const hasMore = status === "CanLoadMore" || status === "LoadingMore";
  const selection = useSourceSelection(visible);
  useThumbnailRequests(instanceId, tab === "all" ? visible : []);

  return (
    <div className="grid gap-8">
      <PageHeader title="Sources" description="What your agents spotted out there: social posts, keywords and other signals, scored for inspiration." />

      {status === "LoadingFirstPage" ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Sources yet.</p>
      ) : (
        <>
          {/* Counted over the loaded rows (no server-side counter exists), so
              the first tile says "Loaded" until every page is in. */}
          <section aria-label="Source counts" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatTile icon={Layers} label={hasMore ? "Loaded sources" : "Total sources"} value={sources.length} tone="visual" />
            <StatTile icon={LoaderCircle} label="Processing" value={count((s) => s.status === "processing")} tone="research" />
            <StatTile icon={CircleCheck} label="Ready" value={count((s) => s.status === "ready")} tone="engagement" />
            <StatTile icon={CircleX} label="Failed" value={count((s) => s.status === "failed")} tone="error" />
            <StatTile icon={Ban} label="Unavailable" value={count((s) => s.status === "unavailable")} />
          </section>

          <FilterChips
            label="Sources view"
            value={tab}
            onChange={(id) => setTab(id === "all" ? "all" : "ready")}
            options={[
              { id: "ready", label: "Ready", count: count((source) => stageOf(source) === READY_TAB_STAGE) },
              { id: "all", label: "All", count: sources.length },
            ]}
          />

          {tab === "ready" ? (
            <ReadySources
              sources={sources}
              instanceId={instanceId}
              hasMore={hasMore}
              loadingMore={status === "LoadingMore"}
              onLoadMore={() => loadMore(PAGE_SIZE)}
            />
          ) : null}

          {tab === "all" ? (
          <section className="grid gap-5">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
              <div className="flex flex-wrap gap-3">
                <FilterChips options={STATUS_CHIPS} value={stage} onChange={setStage} label="Filter by status" />
                <NativeSelect
                  aria-label="Filter by agent"
                  className="h-11 sm:w-48"
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
                <NativeSelect
                  aria-label="Filter by status"
                  className="h-11 sm:w-48"
                  value={stage}
                  onChange={(event) => setStage(event.target.value)}
                >
                  <option value="all">All statuses</option>
                  <option value={READY_ANY}>Ready (any stage)</option>
                  {STATUS_STAGES.map((option) => (
                    <option key={option} value={option}>
                      {STAGE_LABELS[option] ?? option}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <SearchField value={search} onChange={setSearch} label="Search sources" placeholder="Search sources…" />
                <SelectButton selection={selection} />
              </div>
            </div>

            <SelectionBar selection={selection} />

            {visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">No Sources match these filters.</p>
            ) : (
              <div className="grid gap-3">
                <div
                  aria-hidden="true"
                  className={cn(selection.selecting ? SELECT_ROW_GRID : ROW_GRID, "px-5 text-sm text-muted-foreground max-lg:hidden")}
                >
                  {selection.selecting ? <span /> : null}
                  <span>Source</span>
                  <span>Status</span>
                  <span>Agent</span>
                  <span>Family</span>
                  <span>Created</span>
                  <span>Score</span>
                  <span className="text-right">Actions</span>
                </div>
                <ul className="grid gap-3">
                  {visible.map((source) => (
                    <SourceRowItem
                      key={source._id}
                      source={source}
                      instanceId={instanceId}
                      selecting={selection.selecting}
                      selected={selection.selected.has(source._id)}
                      onToggle={() => selection.toggleOne(source._id)}
                    />
                  ))}
                </ul>
              </div>
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
 * the All and Ready tabs; `visible` is the list on screen. */
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

const ROW_GRID =
  "grid items-center gap-x-4 lg:grid-cols-[minmax(0,3fr)_9rem_minmax(0,1.2fr)_minmax(0,1fr)_7rem_4rem_6rem]";

// The Agent id is `@scope/slug`; the slug reads as the Agent's name.
function agentLabel(templateId: string): string {
  const slug = templateId.split("/").pop() ?? templateId;
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

// Scores are 0..1. `replicationScore` only exists once the daily engagement
// job has run; before that a scored Source only has its three rubric scores,
// so their mean stands in. Shown on a 0..100 scale.
function sourceScore(scoring: SourceRow["scoring"]): number | undefined {
  if (scoring === undefined) return undefined;
  const { replicationScore, productFit, replicability, creativeStrength } = scoring;
  const value =
    replicationScore ??
    (productFit !== undefined && replicability !== undefined && creativeStrength !== undefined
      ? (productFit + replicability + creativeStrength) / 3
      : undefined);
  return value === undefined ? undefined : Math.round(value * 100);
}

function isWebUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}

// No thumbnail is stored on a Source, so the leading tile shows the kind of
// content its family names.
function SourceGlyph({ family, className = "size-14" }: { family: string; className?: string }) {
  const Icon = /tiktok|music|audio/i.test(family) ? Music2 : Video;
  return (
    <span
      aria-hidden="true"
      className={cn("flex shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground", className)}
    >
      <Icon className="size-6" />
    </span>
  );
}

// Asks the server for the thumbnails of the rows on screen that never had one
// (images are copied server side; a Source without one keeps its glyph).
function useThumbnailRequests(instanceId: string, rows: SourceRow[]): void {
  const requestThumbnails = useMutation(api.source_thumbnails.request);
  const missingKey = rows
    .filter((source) => !source.thumbnailUrl && source.thumbnailTriedAt === undefined)
    .map((source) => source._id)
    .join(",");
  useEffect(() => {
    if (missingKey === "") return;
    void requestThumbnails({ instanceId, sourceIds: missingKey.split(",") as Id<"sources">[] }).catch(() => undefined);
  }, [missingKey, instanceId, requestThumbnails]);
}

// The page's own image when one was fetched, else the glyph of its family.
function SourceThumbnail({ source, className = "size-14" }: { source: SourceRow; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!source.thumbnailUrl || broken) return <SourceGlyph family={source.family} className={className} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={source.thumbnailUrl} alt="" className={cn("shrink-0 rounded-xl object-cover", className)} loading="lazy" onError={() => setBroken(true)} />
  );
}

// Select mode adds a leading checkbox column.
const SELECT_ROW_GRID =
  "grid items-center gap-x-4 lg:grid-cols-[1.25rem_minmax(0,3fr)_9rem_minmax(0,1.2fr)_minmax(0,1fr)_7rem_4rem_6rem]";

function SourceRowItem({
  source,
  instanceId,
  selecting,
  selected,
  onToggle,
}: {
  source: SourceRow;
  instanceId: string;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  // What the Source teaches is the most readable title; the origin is the
  // fallback, and is then only repeated below as provenance when it is not
  // already the title.
  const title = source.marketing.summary ?? source.origin;
  const score = sourceScore(source.scoring);
  return (
    <li>
      <Card
        className={cn(
          selecting ? SELECT_ROW_GRID : ROW_GRID,
          "relative cursor-pointer gap-y-3 px-5 py-3 transition-colors hover:bg-surface-raised has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring",
          selected && "ring-2 ring-primary"
        )}
      >
        {selecting ? (
          <div className="relative z-10">
            <Checkbox checked={selected} onCheckedChange={onToggle} aria-label={`Select ${title}`} />
          </div>
        ) : null}
        <div className="flex min-w-0 items-center gap-4">
          <SourceThumbnail source={source} className="size-[4.5rem]" />
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5">
            <Link
              href={`/projects/${encodeURIComponent(instanceId)}/sources/${encodeURIComponent(source._id)}`}
              className="m-0 w-fit max-w-full truncate text-base font-semibold text-foreground outline-none after:absolute after:inset-0 after:content-['']"
              onClick={(event) => {
                // In select mode the whole row toggles; it never opens the Source.
                if (!selecting) return;
                event.preventDefault();
                onToggle();
              }}
            >
              {title}
            </Link>
            <p className="m-0 truncate text-sm text-muted-foreground">
              {source.marketing.summary ? `${source.label} · ${source.origin}` : source.label}
            </p>
          </div>
        </div>
        <div>
          <SourcePipelinePill source={source} />
        </div>
        <span className="truncate text-sm text-muted-foreground">{agentLabel(source.templateId)}</span>
        <span className="truncate text-sm text-foreground">{source.family}</span>
        <span className="text-sm text-muted-foreground tabular-nums">{formatSourceDate(source.createdAt)}</span>
        <span className="text-sm text-foreground tabular-nums">
          {score ?? "–"}
        </span>
        <div className="relative z-10 flex justify-end">
          {isWebUrl(source.origin) ? (
            <Button
              variant="outline"
              size="icon"
              nativeButton={false}
              render={<a href={source.origin} target="_blank" rel="noreferrer" aria-label="Open original" />}
            >
              <ExternalLink />
            </Button>
          ) : null}
        </div>
      </Card>
    </li>
  );
}

type Target = { templateId: string; agentName: string; missionType: string; label: string; description: string };

const AUTO_TARGET = "auto";
const targetKey = (target: { templateId: string; missionType: string }) => `${target.templateId}::${target.missionType}`;

// "Instagram Reel", "TikTok video", "Instagram image"…: the platform the Source
// came from and the kind of media it is. Falls back to the declared label.
function formatLabel(source: SourceRow): string {
  const platform = source.sourceId === "instagram-reel" ? "Instagram" : source.sourceId === "tiktok-post" ? "TikTok" : undefined;
  const features = (source.analysis as { creativeFeatures?: { mediaType?: unknown } } | undefined)?.creativeFeatures;
  const media = features?.mediaType;
  if (!platform || typeof media !== "string") return source.label;
  const noun = media === "video" ? (platform === "Instagram" ? "Reel" : "video") : media;
  return `${platform} ${noun}`;
}

type ReadySort = "score" | "newest";

function ReadySources({ sources, instanceId, hasMore, loadingMore, onLoadMore }: {
  sources: SourceRow[];
  instanceId: string;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const [sort, setSort] = useState<ReadySort>("score");
  const [agent, setAgent] = useState("all");
  const [search, setSearch] = useState("");
  const targets = (useQuery(api.source_routing.listTargets, { instanceId }) ?? []) as Target[];
  const needle = search.trim().toLowerCase();
  const ready = sources
    .filter((source) => stageOf(source) === READY_TAB_STAGE)
    .filter((source) => agent === "all" || source.templateId === agent)
    .filter((source) => needle === "" || `${source.marketing.summary ?? ""} ${source.origin}`.toLowerCase().includes(needle))
    .sort((a, b) => (sort === "score" ? (sourceScore(b.scoring) ?? -1) - (sourceScore(a.scoring) ?? -1) : b.createdAt - a.createdAt));
  const agents = [...new Set(sources.filter((source) => stageOf(source) === READY_TAB_STAGE).map((source) => source.templateId))].sort();
  const selection = useSourceSelection(ready);
  useThumbnailRequests(instanceId, ready);

  return (
    <section aria-label="Ready sources" className="grid gap-5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <p className="m-0 text-sm text-muted-foreground">
          Scored Sources waiting for production. Pick where each one is routed to, then Produce.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <SearchField value={search} onChange={setSearch} label="Search ready sources" placeholder="Search sources…" />
          <NativeSelect aria-label="Sort ready sources" className="h-11 sm:w-44" value={sort} onChange={(event) => setSort(event.target.value === "newest" ? "newest" : "score")}>
            <option value="score">Highest score</option>
            <option value="newest">Newest first</option>
          </NativeSelect>
          <NativeSelect aria-label="Filter ready sources by agent" className="h-11 sm:w-48" value={agent} onChange={(event) => setAgent(event.target.value)}>
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
        <p className="text-sm text-muted-foreground">No scored Sources waiting for production.</p>
      ) : (
        <ul className="grid gap-3">
          {ready.map((source) => (
            <ReadySourceRow
              key={source._id}
              source={source}
              instanceId={instanceId}
              targets={targets}
              selecting={selection.selecting}
              selected={selection.selected.has(source._id)}
              onToggle={() => selection.toggleOne(source._id)}
            />
          ))}
        </ul>
      )}

      {hasMore ? (
        <div>
          <Button type="button" variant="outline" disabled={loadingMore} onClick={onLoadMore}>
            Load more
          </Button>
        </div>
      ) : null}

      <DeleteSourcesDialog selection={selection} />
    </section>
  );
}

function ReadySourceRow({ source, instanceId, targets, selecting, selected, onToggle }: {
  source: SourceRow;
  instanceId: string;
  targets: Target[];
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const setRouteTarget = useMutation(api.source_routing.setRouteTarget);
  const produce = useMutation(api.source_routing.forceProduction);
  const [busy, setBusy] = useState(false);
  const title = source.marketing.summary ?? source.origin;
  const score = sourceScore(source.scoring);
  // What Produce will use: the producer chosen by hand, else the router's own
  // proposal, else the router decides when Produce is pressed.
  const proposal = source.routing?.state === "proposed" ? source.routing : undefined;
  const current = source.routeTo ?? proposal;
  const value = current ? targetKey(current) : AUTO_TARGET;

  async function onRouteChange(next: string): Promise<void> {
    const target = targets.find((entry) => targetKey(entry) === next);
    try {
      await setRouteTarget({ sourceId: source._id as Id<"sources">, target: target ? { templateId: target.templateId, missionType: target.missionType } : null });
    } catch (error: unknown) {
      window.alert(extractConvexErrorMessage(error, "Could not change where the Source is routed to."));
    }
  }

  async function onProduce(): Promise<void> {
    setBusy(true);
    try {
      await produce({ sourceId: source._id as Id<"sources"> });
    } catch (error: unknown) {
      window.alert(extractConvexErrorMessage(error, "Failed to start production."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <Card
        className={cn(
          "relative flex cursor-pointer flex-col gap-4 p-3 transition-colors hover:bg-surface-raised has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring lg:flex-row lg:items-center lg:pr-5",
          selected && "ring-2 ring-primary",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-4">
          {selecting ? (
            <div className="relative z-10 pl-2">
              <Checkbox checked={selected} onCheckedChange={onToggle} aria-label={`Select ${title}`} />
            </div>
          ) : null}
          <SourceThumbnail source={source} className="size-24" />
          <div className="grid min-w-0 gap-2">
            <Link
              href={`/projects/${encodeURIComponent(instanceId)}/sources/${encodeURIComponent(source._id)}`}
              className="m-0 break-words text-base font-semibold text-foreground outline-none line-clamp-2 after:absolute after:inset-0 after:content-['']"
              onClick={(event) => {
                // In select mode the title toggles the row; it never opens the Source.
                if (!selecting) return;
                event.preventDefault();
                onToggle();
              }}
            >
              {title}
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{formatLabel(source)}</Badge>
              {score !== undefined ? <Badge variant="outline" className="tabular-nums">Score {score}</Badge> : null}
            </div>
          </div>
        </div>
        <div className="relative z-10 flex flex-wrap items-center gap-3 lg:justify-end">
          <label className="flex flex-col items-start gap-1 text-sm text-muted-foreground" title={proposal && !source.routeTo ? proposal.rationale : undefined}>
            Routed to:
            <NativeSelect aria-label="Routed to" className="h-10 w-56" value={value} onChange={(event) => void onRouteChange(event.target.value)}>
              <option value={AUTO_TARGET}>Auto (router decides)</option>
              {targets.map((target) => (
                <option key={targetKey(target)} value={targetKey(target)}>
                  {agentLabel(target.templateId)} · {target.label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <Button type="button" variant="accent" disabled={busy} onClick={() => void onProduce()}>
            <Sparkles />
            Produce
          </Button>
        </div>
      </Card>
    </li>
  );
}
