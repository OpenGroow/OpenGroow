"use client";

import { use } from "react";
import Link from "next/link";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/opengroow/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { formatSourceDate } from "@/src/components/source-status-pill";
import { useAssignSource, type ClassifiableSource } from "@/src/components/creative-family-source-actions";
import { isActiveFamily, sourceTitle } from "@/src/lib/creative-library";
import { FormatBadge, SourceThumbnail, useSourcePlatforms, useThumbnailRequests } from "@/src/components/source-visuals";

// Sources that belong to no Creative Family, each with a family picker (ADR-082).

const PAGE_SIZE = 25;

type FamilyOption = { _id: string; name: string; status: "active" | "archived" };
type UnclassifiedSource = ClassifiableSource & { createdAt: number };

type Props = { params: Promise<{ instanceId: string }> };

export function CreativeUnclassifiedPage({ params }: Props) {
  const { instanceId } = use(params);
  return <CreativeUnclassifiedContent instanceId={decodeURIComponent(instanceId)} />;
}

export function CreativeUnclassifiedContent({ instanceId }: { instanceId: string }) {
  const families = useQuery(api.creative_families.list, { instanceId }) as FamilyOption[] | undefined;
  const { results, status, loadMore } = usePaginatedQuery(
    api.creative_families.listUnclassified,
    { instanceId },
    { initialNumItems: PAGE_SIZE },
  ) as { results: UnclassifiedSource[]; status: string; loadMore: (numItems: number) => void };
  const { assign, error } = useAssignSource(instanceId);
  const platformFor = useSourcePlatforms(instanceId);
  useThumbnailRequests(instanceId, results);
  const destinations = (families ?? []).filter(isActiveFamily);

  return (
    <div className="grid gap-8">
      <div className="grid gap-4">
        <Link
          href={`/projects/${encodeURIComponent(instanceId)}/library`}
          className="flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Creative Library
        </Link>
        <PageHeader title="Unclassified Sources" description="Sources that belong to no Creative Family yet." />
      </div>
      {error ? <p role="alert" className="m-0 text-sm text-destructive">{error}</p> : null}
      {status === "LoadingFirstPage" ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : results.length === 0 ? (
        <p className="text-sm text-muted-foreground">No unclassified Sources.</p>
      ) : (
        <ul className="grid gap-3">
          {results.map((source) => (
            <li key={source._id}>
              <Card className="flex flex-col gap-4 px-5 py-3 lg:flex-row lg:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <SourceThumbnail source={source} className="size-20" />
                  <div className="grid min-w-0 gap-1">
                    <Link
                      href={`/projects/${encodeURIComponent(instanceId)}/sources/${encodeURIComponent(source._id)}`}
                      className="w-fit max-w-full truncate text-base font-semibold text-foreground"
                    >
                      {sourceTitle(source)}
                    </Link>
                    <div className="flex flex-wrap items-center gap-3">
                      <FormatBadge source={source} platform={platformFor(source)} />
                      <span className="text-sm text-muted-foreground tabular-nums">{formatSourceDate(source.createdAt)}</span>
                    </div>
                  </div>
                </div>
                <NativeSelect
                  aria-label={`Family for ${sourceTitle(source)}`}
                  className="h-11 lg:w-56"
                  value=""
                  onChange={(event) => {
                    const familyId = event.target.value;
                    if (!familyId) return;
                    assign(source._id, familyId);
                  }}
                >
                  <option value="">Choose a family…</option>
                  {destinations.map((family) => (
                    <option key={family._id} value={family._id}>
                      {family.name}
                    </option>
                  ))}
                </NativeSelect>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {status === "CanLoadMore" ? (
        <Button type="button" variant="outline" className="w-fit" onClick={() => loadMore(PAGE_SIZE)}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}
