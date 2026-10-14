"use client";

import Link from "next/link";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import { blockedExternalResult } from "@/src/lib/mission-result";

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
          className="flex min-w-[220px] flex-1 flex-col gap-3 rounded-[1.5rem] border border-[rgba(0,38,27,0.08)] bg-[#f8f9f7] p-4"
        >
          <h3 className="m-0 text-[0.8rem] font-bold uppercase tracking-[0.14em] text-[var(--dashboard-ink-soft)]">
            {col.label}
          </h3>

          {byColumn[col.id].length === 0 ? (
            <p className="text-[0.82rem] text-[var(--dashboard-ink-muted)]">—</p>
          ) : (
            byColumn[col.id].map((mission) => (
              <MissionCard key={mission._id} mission={mission} projectId={projectId} />
            ))
          )}

          {col.id === "done" && canLoadMoreDone && (
            <button
              type="button"
              disabled={doneStatus === "LoadingMore"}
              onClick={() => onLoadMoreDone?.()}
              className="mt-1 inline-flex min-h-8 items-center justify-center rounded-xl border border-[rgba(0,38,27,0.12)] bg-white px-3 py-1 text-[0.78rem] font-semibold text-[var(--dashboard-ink-soft)] transition hover:border-[rgba(0,38,27,0.2)] disabled:opacity-50"
            >
              {doneStatus === "LoadingMore" ? "Loading…" : "Load more"}
            </button>
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
      className="flex flex-col gap-2 rounded-2xl border border-[rgba(0,38,27,0.08)] bg-white p-3 shadow-[0_2px_8px_rgba(25,28,28,0.04)]"
    >
      <Link
        href={detailHref}
        className="flex flex-col gap-2 no-underline"
      >
        <div className="flex flex-col gap-1.5">
          <span className="break-words text-[0.88rem] font-semibold text-[var(--dashboard-ink)]">
            {titleCase(mission.type)}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {mission.status === "failed" && (
              <span className="shrink-0 rounded-full bg-red-100 px-2.5 py-0.5 text-[0.72rem] font-bold text-red-700">
                Failed
              </span>
            )}
            {mission.status === "blocked" && (
              <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-[0.72rem] font-bold text-amber-800">
                Blocked
              </span>
            )}
            {/* `cancelled` shares the "In progress" column with live Missions,
                so without a badge an operator-stopped Mission would be
                indistinguishable from a running one. "Stopped" is its canonical
                UI term (GLOSSARY.md, Mission statuses). */}
            {mission.status === "cancelled" && (
              <span className="shrink-0 rounded-full bg-[rgba(0,38,27,0.07)] px-2.5 py-0.5 text-[0.72rem] font-bold text-[var(--dashboard-ink-soft)]">
                Stopped
              </span>
            )}
            {mission.sourceObservationId !== undefined && (
              <span
                data-testid="from-observation-badge"
                className="shrink-0 rounded-full bg-[rgba(188,237,215,0.7)] px-2.5 py-0.5 text-[0.72rem] font-bold text-[var(--dashboard-primary)]"
              >
                From Source
              </span>
            )}
          </div>
        </div>

        {summaryLine(mission) ? (
          <p className="m-0 break-words text-[0.82rem] text-[var(--dashboard-ink-soft)] line-clamp-2">
            {summaryLine(mission)}
          </p>
        ) : null}

        {mission.number !== undefined ? (
          <span
            data-mission-number
            className="text-[0.72rem] text-[var(--dashboard-ink-muted)]"
          >
            #{mission.number}
          </span>
        ) : null}
      </Link>

      {/* Rendered outside the detail-page <Link> — an <a> cannot nest inside another <a>. */}
      {blocked && (
        <p className="m-0 rounded-lg bg-amber-50 px-2.5 py-2 text-[0.78rem] leading-5 text-amber-900">
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
            className="inline-flex min-h-8 flex-1 items-center justify-center rounded-xl border border-[rgba(0,38,27,0.12)] bg-[linear-gradient(135deg,rgba(188,237,215,0.96),rgba(227,242,234,0.98))] px-3 py-1 text-[0.78rem] font-semibold text-[var(--dashboard-primary)] transition hover:border-[rgba(0,38,27,0.18)]"
          >
            {mission.status === "approved" ? "Publish" : "Review"}
          </Link>
        )}
        {showDelete && (
          <button
            type="button"
            aria-label="Delete mission"
            data-delete-mission={mission._id}
            onClick={(e) => void handleDelete(e)}
            className="ml-auto inline-flex min-h-8 items-center justify-center rounded-xl border border-[rgba(126,61,53,0.18)] bg-transparent px-2.5 py-1 text-[0.72rem] font-semibold text-[#7e3d35] transition hover:bg-[rgba(126,61,53,0.06)]"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
