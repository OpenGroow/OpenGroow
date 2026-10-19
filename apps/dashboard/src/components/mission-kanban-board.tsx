"use client";

import Link from "next/link";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import { blockedExternalResult } from "@/src/lib/mission-result";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
};

const COLUMNS = [
  { id: "todo", label: "To do" },
  { id: "doing", label: "In progress" },
  { id: "blocked", label: "Blocked" },
  { id: "to_validate", label: "To validate" },
  { id: "approved", label: "To publish" },
  { id: "done", label: "Done" },
] as const;

type ColumnId = (typeof COLUMNS)[number]["id"];

function columnForMission(status: Mission["status"]): ColumnId {
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

export function MissionKanbanBoard({
  missions,
  projectId,
  doneMissions,
  doneStatus,
  onLoadMoreDone,
}: Props) {
  const byColumn: Record<ColumnId, Mission[]> = {
    todo: [],
    doing: [],
    blocked: [],
    to_validate: [],
    approved: [],
    done: [],
  };

  for (const m of missions) {
    byColumn[columnForMission(m.status)].push(m);
  }
  if (doneMissions) {
    byColumn.done.push(...doneMissions);
  }

  for (const col of COLUMNS) {
    byColumn[col.id].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  const canLoadMoreDone = onLoadMoreDone && (doneStatus === "CanLoadMore" || doneStatus === "LoadingMore");

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {COLUMNS.map((col) => (
        <div
          key={col.id}
          data-column={col.id}
          className="flex min-w-[220px] flex-1 flex-col gap-3 rounded-xl border border-border bg-background p-4"
        >
          <h3 className="m-0 text-xs font-semibold text-muted-foreground">
            {col.label}
          </h3>

          {byColumn[col.id].length === 0 ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : (
            byColumn[col.id].map((mission) => (
              <MissionCard key={mission._id} mission={mission} projectId={projectId} />
            ))
          )}

          {col.id === "done" && canLoadMoreDone && (
            <Button
              variant="outline"
              size="sm"
              type="button"
              disabled={doneStatus === "LoadingMore"}
              onClick={() => onLoadMoreDone?.()}
              className="mt-1"
            >
              {doneStatus === "LoadingMore" ? "Loading…" : "Load more"}
            </Button>
          )}
        </div>
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
    <div
      data-mission={mission._id}
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3"
    >
      <Link
        href={detailHref}
        className="flex flex-col gap-2 no-underline"
      >
        <div className="flex flex-col gap-1.5">
          <span className="break-words text-sm font-semibold text-foreground">
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
          <Link
            href={`/projects/${encodeURIComponent(projectId)}/missions/${encodeURIComponent(mission._id)}/review`}
            className="inline-flex min-h-8 flex-1 items-center justify-center rounded-xl border border-border bg-primary/15 px-3 py-1 text-xs font-semibold text-primary transition hover:border-input"
          >
            {mission.status === "approved" ? "Publish" : "Review"}
          </Link>
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
    </div>
  );
}
