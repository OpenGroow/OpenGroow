"use client";

import { use, useState } from "react";
import Link from "next/link";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { formatSourceDate, SourcePipelinePill } from "@/src/components/source-status-pill";
import { PageHeader } from "@/components/opengroow/page-header";
import { FilterChips } from "@/components/opengroow/filter-bar";
import { Card } from "@/components/ui/card";

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
      <PageHeader title="Sources" description="Information sources your agents monitor." />

      <section className="grid gap-5">
        {status === "LoadingFirstPage" ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : sources.length === 0 && family === null ? (
          <p className="text-sm text-muted-foreground">No Sources yet.</p>
        ) : (
          <>
            <FilterChips
              options={[null, ...families].map((option) => ({ id: option ?? "all", label: option ?? "All" }))}
              value={family ?? "all"}
              onChange={(id) => setFamily(id === "all" ? null : id)}
              label="Filter by family"
            />
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
    <li>
      <Card className="gap-1.5 p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <SourcePipelinePill source={source} />
      </div>
      <Link
        href={`/projects/${encodeURIComponent(instanceId)}/sources/${encodeURIComponent(source._id)}`}
        className="m-0 w-fit break-words text-base font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {title}
      </Link>
      <p className="m-0 text-sm text-muted-foreground">
        {source.label} · {source.family} · {formatSourceDate(source.capturedAt)}
      </p>
      {source.marketing.summary ? (
        <p className="m-0 break-all text-xs text-muted-foreground">{source.origin}</p>
      ) : null}
    </Card>
    </li>
  );
}
