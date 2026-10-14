"use client";

import { use, useState } from "react";
import Link from "next/link";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { formatSourceDate, SourcePipelinePill } from "@/src/components/source-status-pill";

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
  | "capturedAt"
  | "marketing"
  | "scoring"
  | "selectedAt"
  | "productionMissionId"
  | "producedAt"
  | "publishedAt"
  | "excluded"
> & { _id: string };

const FILTER_BUTTON =
  "rounded-full border px-3 py-1 text-[0.78rem] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dashboard-primary)] focus-visible:ring-offset-2";

const PAGE_SIZE = 50;

export function InstanceSourcesContent({ instanceId }: { instanceId: string }) {
  const [family, setFamily] = useState<string | null>(null);
  const families = useQuery(api.sources.listFamilies, { instanceId }) ?? [];
  const {
    results: sources,
    status,
    loadMore,
  } = usePaginatedQuery(
    api.sources.listByInstance,
    family === null ? { instanceId } : { instanceId, family },
    { initialNumItems: PAGE_SIZE },
  ) as { results: SourceRow[]; status: string; loadMore: (numItems: number) => void };

  return (
    <div className="grid gap-8">
      <header className="grid gap-1">
        <span className="text-[0.75rem] font-bold uppercase tracking-[0.18em] text-[var(--dashboard-ink-soft)]">
          Project
        </span>
        <h1 className="m-0 text-[clamp(1.6rem,3vw,2.5rem)] font-extrabold leading-[0.98] tracking-[-0.04em] text-[var(--dashboard-ink)]">
          Sources
        </h1>
      </header>

      <section className="grid gap-5">
        {status === "LoadingFirstPage" ? (
          <p className="text-[0.92rem] text-[var(--dashboard-ink-muted)]">Loading…</p>
        ) : sources.length === 0 && family === null ? (
          <p className="text-[0.92rem] text-[var(--dashboard-ink-muted)]">No Sources yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by family">
              {[null, ...families].map((option) => (
                <button
                  key={option ?? "all"}
                  type="button"
                  aria-pressed={option === family}
                  onClick={() => setFamily(option)}
                  className={`${FILTER_BUTTON} ${
                    option === family
                      ? "border-[var(--dashboard-primary)] bg-[var(--dashboard-primary)] text-white"
                      : "border-[rgba(0,38,27,0.12)] bg-transparent text-[var(--dashboard-ink-soft)] hover:border-[var(--dashboard-primary)]"
                  }`}
                >
                  {option ?? "All"}
                </button>
              ))}
            </div>
            <ul className="grid gap-3">
              {sources.map((source) => (
                <SourceRowItem key={source._id} source={source} instanceId={instanceId} />
              ))}
            </ul>
            {status === "CanLoadMore" || status === "LoadingMore" ? (
              <Button
                type="button"
                variant="outline"
                className="w-fit"
                disabled={status === "LoadingMore"}
                onClick={() => loadMore(PAGE_SIZE)}
              >
                Load more
              </Button>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

function SourceRowItem({ source, instanceId }: { source: SourceRow; instanceId: string }) {
  // What the Source teaches is the most readable title; the origin is the
  // fallback, and is then only repeated below as provenance when it is not
  // already the title.
  const title = source.marketing.summary ?? source.origin;
  return (
    <li className="grid gap-1.5 rounded-2xl border border-[rgba(0,38,27,0.08)] bg-[#f8f9f7] p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <SourcePipelinePill source={source} />
      </div>
      <Link
        href={`/projects/${encodeURIComponent(instanceId)}/sources/${encodeURIComponent(source._id)}`}
        className="m-0 w-fit break-words text-[1rem] font-bold text-[var(--dashboard-ink)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dashboard-primary)] focus-visible:ring-offset-2"
      >
        {title}
      </Link>
      <p className="m-0 text-[0.82rem] text-[var(--dashboard-ink-muted)]">
        {source.label} · {source.family} · {formatSourceDate(source.capturedAt)}
      </p>
      {source.marketing.summary ? (
        <p className="m-0 break-all text-[0.78rem] text-[var(--dashboard-ink-muted)]">{source.origin}</p>
      ) : null}
    </li>
  );
}
