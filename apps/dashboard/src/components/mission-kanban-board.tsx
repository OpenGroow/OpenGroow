"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ListChecks,
  Loader2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import { blockedExternalResult } from "@/src/lib/mission-result";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/opengroow/status-badge";

// Drift-prone fields (the status union, the run-result shape, names, etc.) are
// derived from the schema so they stay in sync and callers can pass query
// results without a cast. `_id` is kept as a plain string (the board never
// passes it back to Convex except via the delete path, where it is cast) so
// fixtures stay lightweight.
type Mission = Pick<
  Doc<"missions">,
  | "type"
  | "status"
  | "updatedAt"
  | "number"
  | "name"
  | "summary"
  | "lastResult"
  | "sourceObservationId"
> & {
  _id: string;
};

type Props = {
  missions: Mission[];
  projectId: string;
  // Optional: a separately (paginated) fetched slice of `done` missions,
  // merged into the Done column alongside any `done` items already present in
  // `missions`. Lets the Done column grow via "Load more" instead of the
  // board having to fetch/render every completed Mission up front.
  doneMissions?: Mission[];
  doneStatus?: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
  onLoadMoreDone?: () => void;
  // Lower-cased text typed in the search field; matches the type, name and
  // summary of a Mission. Empty shows everything.
  query?: string;
  sort?: "newest" | "oldest";
};

// `dot` is the column's colour marker (a label always sits next to it); the
// empty state tells the user what the column is for.
export const COLUMNS = [
  {
    id: "todo",
    label: "To do",
    dot: "bg-tone-slate",
    icon: ListChecks,
    emptyTitle: "No missions yet",
    emptyText: "Create a new mission to get started.",
  },
  {
    id: "doing",
    label: "In progress",
    dot: "bg-tone-cyan",
    icon: Loader2,
    emptyTitle: "Nothing in progress",
    emptyText: "Missions in progress will appear here.",
  },
  {
    id: "blocked",
    label: "Blocked",
    dot: "bg-status-warning",
    icon: AlertTriangle,
    emptyTitle: "No blocked missions",
    emptyText: "Missions that need attention will appear here.",
  },
  {
    id: "to_validate",
    label: "To validate",
    dot: "bg-tone-violet",
    icon: CheckCircle2,
    emptyTitle: "Nothing to validate",
    emptyText: "Missions ready for review will appear here.",
  },
  {
    id: "approved",
    label: "To publish",
    dot: "bg-tone-green",
    icon: Upload,
    emptyTitle: "Nothing to publish",
    emptyText: "Approved missions will appear here before publishing.",
  },
  {
    id: "done",
    label: "Done",
    dot: "bg-tone-slate",
    icon: CheckCircle2,
    emptyTitle: "Nothing done yet",
    emptyText: "Completed missions will appear here.",
  },
] as const satisfies readonly {
  id: string;
  label: string;
  dot: string;
  icon: LucideIcon;
  emptyTitle: string;
  emptyText: string;
}[];

type ColumnId = (typeof COLUMNS)[number]["id"];

export function columnForMission(status: Mission["status"]): ColumnId {
  // `cancelled` (issue #482, an operator-initiated Stop) has no dedicated
  // column, same as `failed` — both render in "In progress" so the board's
  // status coverage stays exhaustive.
  if (status === "failed" || status === "cancelled") return "doing";
  return status;
}

function titleCase(type: string): string {
  return type
    .split("_")
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

// Default mission names are generated as `${type} #${number}` (see
// missions.ts). The card title already shows the type (in Title Case), so
// strip a trailing "#N" suffix and drop the line entirely when what's left
// is just the type again — custom names/summaries are left untouched.
function summaryLine(mission: Mission): string | undefined {
  const text = mission.summary ?? mission.name;
  if (!text) return undefined;
  const suffix = mission.number !== undefined ? ` #${mission.number}` : "";
  const withoutNumber = suffix && text.endsWith(suffix) ? text.slice(0, -suffix.length) : text;
  return withoutNumber === mission.type ? undefined : withoutNumber;
}

function hasReviewableArtifact(mission: Mission): boolean {
  const result = mission.lastResult;
  // The `failed` run-result variant carries no artifact, so narrow before access.
  if (!result || !("artifact" in result)) return false;
  const artifact = result.artifact;
  if (!artifact) return false;
  // Strict contract (ADR-020 / #146): identity lives in artifact.external.id only.
  return typeof artifact.external?.id === "string";
}

// Active columns reveal their Missions by batches of this size; Done pages on
// the server instead (see `onLoadMoreDone`).
const COLUMN_PAGE_SIZE = 5;

export function MissionKanbanBoard({
  missions,
  projectId,
  doneMissions,
  doneStatus,
  onLoadMoreDone,
  query = "",
  sort = "newest",
}: Props) {
  const [visibleCount, setVisibleCount] = useState<Partial<Record<ColumnId, number>>>({});
  const byColumn: Record<ColumnId, Mission[]> = {
    todo: [],
    doing: [],
    blocked: [],
    to_validate: [],
    approved: [],
    done: [],
  };

  const needle = query.trim().toLowerCase();
  const matches = (m: Mission): boolean =>
    !needle ||
    [m.type, titleCase(m.type), m.name, m.summary].some((text) => text?.toLowerCase().includes(needle));

  for (const m of missions) {
    if (matches(m)) byColumn[columnForMission(m.status)].push(m);
  }
  if (doneMissions) {
    byColumn.done.push(...doneMissions.filter(matches));
  }

  for (const col of COLUMNS) {
    byColumn[col.id].sort((a, b) => (sort === "newest" ? b.updatedAt - a.updatedAt : a.updatedAt - b.updatedAt));
  }

  const canLoadMoreDone = onLoadMoreDone && (doneStatus === "CanLoadMore" || doneStatus === "LoadingMore");

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {COLUMNS.map((col) => (
        <section
          key={col.id}
          data-column={col.id}
          aria-label={col.label}
          className="flex min-w-60 flex-1 flex-col rounded-2xl border border-border bg-card/50"
        >
          <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
            <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-full", col.dot)} />
            <h3 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
              {col.label}
            </h3>
            <Badge variant="outline" size="xs" className="tabular-nums">
              {byColumn[col.id].length}
            </Badge>
          </header>

          <div className="flex flex-1 flex-col gap-3 p-3">
            {byColumn[col.id].length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-3 py-10 text-center">
                <col.icon aria-hidden="true" className="mb-1 size-8 text-muted-foreground" />
                <p className="m-0 text-sm font-semibold text-foreground">{col.emptyTitle}</p>
                <p className="m-0 text-sm text-muted-foreground">{col.emptyText}</p>
              </div>
            ) : (
              (col.id === "done"
                ? byColumn.done
                : byColumn[col.id].slice(0, visibleCount[col.id] ?? COLUMN_PAGE_SIZE)
              ).map((mission) => (
                <MissionCard key={mission._id} mission={mission} projectId={projectId} />
              ))
            )}

            {col.id !== "done" &&
              byColumn[col.id].length > (visibleCount[col.id] ?? COLUMN_PAGE_SIZE) && (
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() =>
                    setVisibleCount((prev) => ({
                      ...prev,
                      [col.id]: (prev[col.id] ?? COLUMN_PAGE_SIZE) + COLUMN_PAGE_SIZE,
                    }))
                  }
                >
                  <ChevronDown />
                  Load more
                </Button>
              )}

            {col.id === "done" && canLoadMoreDone && (
              <Button
                variant="outline"
                size="sm"
                type="button"
                disabled={doneStatus === "LoadingMore"}
                onClick={() => onLoadMoreDone?.()}
              >
                <ChevronDown />
                {doneStatus === "LoadingMore" ? "Loading…" : "Load more"}
              </Button>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function MissionCard({ mission, projectId }: { mission: Mission; projectId: string }) {
  const deleteMission = useMutation(api.missions.deleteMission);
  const showAction =
    (mission.status === "to_validate" || mission.status === "approved") &&
    hasReviewableArtifact(mission);
  const blocked = blockedExternalResult(mission);
  // Hide delete only on `doing` (a Run is running on the Instance). A `todo`
  // mission stays deletable — its Run is usually still `pending` (queued, not
  // yet on the Instance), which covers clearing a stuck mission. The server
  // guard is the real boundary: it refuses only when a Run is actually live
  // (`dispatching`/`running`).
  const showDelete = mission.status !== "doing";
  const detailHref = `/projects/${encodeURIComponent(projectId)}/missions/${encodeURIComponent(mission._id)}`;

  async function handleDelete(e: React.MouseEvent): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    const confirmed = window.confirm("Permanently delete this mission and all its runs?");
    if (!confirmed) return;
    try {
      await deleteMission({ missionId: mission._id as Id<"missions"> });
    } catch (error: unknown) {
      window.alert(extractConvexErrorMessage(error, "Failed to delete mission"));
    }
  }

  return (
    <Card
      data-mission={mission._id}
      size="sm"
      className="glow-hover gap-2 px-3 py-3"
    >
      <Link
        href={detailHref}
        className="flex flex-col gap-2 no-underline"
      >
        <div className="flex flex-col gap-1.5">
          <span className="flex items-start gap-2 break-words text-sm font-semibold text-foreground">
            {mission.status === "done" && (
              <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-tone-green" />
            )}
            {titleCase(mission.type)}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {mission.status === "failed" && (
              <StatusBadge tone="error" label="Failed" className="shrink-0" />
            )}
            {mission.status === "blocked" && (
              <StatusBadge tone="warning" label="Blocked" className="shrink-0" />
            )}
            {/* `cancelled` shares the "In progress" column with live Missions,
                so without a badge an operator-stopped Mission would be
                indistinguishable from a running one. "Stopped" is its canonical
                UI term (GLOSSARY.md, Mission statuses). */}
            {mission.status === "cancelled" && (
              <StatusBadge tone="neutral" label="Stopped" className="shrink-0" />
            )}
            {mission.sourceObservationId !== undefined && (
              <Badge variant="default" className="shrink-0"
                data-testid="from-observation-badge">
                From Source
              </Badge>
            )}
          </div>
        </div>

        {summaryLine(mission) ? (
          <p className="m-0 break-words text-sm text-muted-foreground line-clamp-2">
            {summaryLine(mission)}
          </p>
        ) : null}

        {mission.number !== undefined ? (
          <span
            data-mission-number
            className="text-xs text-muted-foreground"
          >
            #{mission.number}
          </span>
        ) : null}
      </Link>

      {/* Rendered outside the detail-page <Link> — an <a> cannot nest inside another <a>. */}
      {blocked && (
        <p className="m-0 rounded-lg bg-status-warning/10 px-2.5 py-2 text-xs leading-5 text-status-warning">
          {blocked.message}{" "}
          {blocked.resolution?.kind === "link" && (
            <a href={blocked.resolution.url} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
              Open resolution link
            </a>
          )}
          {blocked.resolution?.kind === "execution_device" && (
            <span className="font-semibold">Resolve on the execution device.</span>
          )}
        </p>
      )}

      <div className="flex items-center gap-2">
        {showAction && (
          <Button
            variant="accent"
            size="sm"
            nativeButton={false}
            render={
              <Link
                href={`/projects/${encodeURIComponent(projectId)}/missions/${encodeURIComponent(mission._id)}/review`}
              />
            }
          >
            {mission.status === "approved" ? "Publish" : "Review"}
          </Button>
        )}
        {showDelete && (
          <Button
            variant="destructive"
            size="sm"
            type="button"
            aria-label="Delete mission"
            data-delete-mission={mission._id}
            onClick={(e) => void handleDelete(e)}
            className="ml-auto"
          >
            Delete
          </Button>
        )}
      </div>
    </Card>
  );
}
