"use client";

import { use, useState } from "react";
import Link from "next/link";
import { usePaginatedQuery, useQuery } from "convex/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/opengroow/page-header";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { WorkspaceMarkdown } from "@/src/components/workspace-markdown";

// The Strategic Memory page (ADR-085): the Project's current memory as rendered
// Markdown, then the history of its Strategic Reviews. Figures stay in Analytics.

const PAGE_SIZE = 10;

type Review = {
  _id: string;
  periodStart: number;
  periodEnd: number;
  report: string;
  consolidatedMemory: string;
  memoryChanged: boolean;
  createdAt: number;
};

type ReviewReferences = {
  recipes: Array<{ id: string; name: string | null }>;
  publications: Array<{ id: string; target: string | null; missionId: string | null }>;
};

const formatDay = (timestamp: number) => new Date(timestamp).toLocaleDateString("en-US", { dateStyle: "medium" });
const periodLabel = (review: Review) => `${formatDay(review.periodStart)} to ${formatDay(review.periodEnd)}`;

type Props = { params: Promise<{ instanceId: string }> };

export function StrategicMemoryPage({ params }: Props) {
  const { instanceId } = use(params);
  return <StrategicMemoryContent instanceId={decodeURIComponent(instanceId)} />;
}

export function StrategicMemoryContent({ instanceId }: { instanceId: string }) {
  const current = useQuery(api.strategic_memory.current, { instanceId }) as Review | null | undefined;
  const { results, status, loadMore } = usePaginatedQuery(api.strategic_memory.history, { instanceId }, { initialNumItems: PAGE_SIZE }) as {
    results: Review[];
    status: string;
    loadMore: (numItems: number) => void;
  };

  return (
    <div className="grid gap-8">
      <PageHeader title="Strategic Memory" description="What your Strategy Agent has learned from your results, consolidated review after review." />
      {current === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : current === null ? (
        <Card className="grid gap-2 p-6">
          <p className="m-0 text-base font-semibold">No Strategic Review yet</p>
          <p className="m-0 text-sm text-muted-foreground">
            Strategic Reviews are run by a Job. Schedule one or run it now from the{" "}
            <Link href={`/projects/${encodeURIComponent(instanceId)}/jobs`} className="text-primary underline underline-offset-4">
              Jobs
            </Link>{" "}
            page.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid gap-3">
            <h2 className="m-0 text-xl font-semibold">Current memory</h2>
            <Card className="grid gap-4 p-6">
              <p className="m-0 text-sm text-muted-foreground">
                Period {periodLabel(current)} · reviewed {formatDay(current.createdAt)}
              </p>
              <section aria-label="Current memory">
                {current.consolidatedMemory.trim() === "" ? (
                  <p className="m-0 text-sm text-muted-foreground">The memory is empty.</p>
                ) : (
                  <WorkspaceMarkdown content={current.consolidatedMemory} />
                )}
              </section>
            </Card>
          </div>
          <section aria-label="History" className="grid gap-3">
            <h2 className="m-0 text-xl font-semibold">History</h2>
            <ul className="m-0 grid list-none gap-3 p-0">
              {results.map((review) => (
                <ReviewEntry key={review._id} instanceId={instanceId} review={review} />
              ))}
            </ul>
            {status === "CanLoadMore" || status === "LoadingMore" ? (
              <Button type="button" variant="outline" className="w-fit justify-self-end" disabled={status === "LoadingMore"} onClick={() => loadMore(PAGE_SIZE)}>
                Load more
              </Button>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}

function ReviewEntry({ instanceId, review }: { instanceId: string; review: Review }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li data-review={review._id}>
      <Card className="grid gap-4 p-4">
        <Button type="button" variant="ghost" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="h-auto w-full justify-start gap-3 whitespace-normal p-2 text-left">
          <Chevron aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-base font-semibold">{formatDay(review.createdAt)}</span>
          <span className="text-sm text-muted-foreground">Period {periodLabel(review)}</span>
          {review.memoryChanged ? null : <StatusBadge tone="neutral" label="Memory unchanged" />}
        </Button>
        {open ? <ReviewDetail instanceId={instanceId} review={review} /> : null}
      </Card>
    </li>
  );
}

function ReviewDetail({ instanceId, review }: { instanceId: string; review: Review }) {
  const references = useQuery(api.strategic_memory.references, { instanceId, reviewId: review._id as Id<"strategicReviews"> }) as ReviewReferences | null | undefined;
  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <h3 className="m-0 text-lg font-semibold">Performance Report</h3>
        <WorkspaceMarkdown content={review.report} />
      </div>
      <div className="grid gap-2">
        <h3 className="m-0 text-lg font-semibold">Memory at that time</h3>
        {review.consolidatedMemory.trim() === "" ? (
          <p className="m-0 text-sm text-muted-foreground">The memory was empty.</p>
        ) : (
          <WorkspaceMarkdown content={review.consolidatedMemory} />
        )}
      </div>
      {references ? <References instanceId={instanceId} references={references} /> : null}
    </div>
  );
}

function References({ instanceId, references }: { instanceId: string; references: ReviewReferences }) {
  const base = `/projects/${encodeURIComponent(instanceId)}`;
  const enc = encodeURIComponent;
  const items: Array<{ key: string; label: string | null; href: string | null }> = [
    ...references.recipes.map((r) => ({
      key: `r-${r.id}`,
      label: r.name,
      href: r.name ? `${base}/recipes/${enc(r.id)}` : null,
    })),
    ...references.publications.map((p) => ({
      key: `p-${p.id}`,
      label: p.target ? `Publication ${p.target}` : null,
      href: p.missionId ? `${base}/missions/${enc(p.missionId)}` : null,
    })),
  ];
  if (items.length === 0) return null;
  return (
    <div className="grid gap-2">
      <h3 className="m-0 text-lg font-semibold">References</h3>
      <ul className="m-0 grid list-none gap-1 p-0 text-sm">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-2">
            {item.href && item.label ? (
              <Link href={item.href} className="text-primary underline underline-offset-4">
                {item.label}
              </Link>
            ) : (
              <span className="text-muted-foreground">{item.label ?? "Deleted"}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
