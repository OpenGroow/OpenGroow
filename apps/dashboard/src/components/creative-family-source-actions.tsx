"use client";

import { useState } from "react";
import { usePaginatedQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import { sourceTitle } from "@/src/lib/creative-library";
import { SourceThumbnail, useThumbnailRequests, type VisualSource } from "@/src/components/source-visuals";

// Hand classification of Sources (ADR-082): remove a Source from its family,
// or add an unclassified one from the family page. A Source is never deleted.

const PAGE_SIZE = 25;

export type ClassifiableSource = VisualSource & { _id: string; origin: string; marketing: { summary?: string } };

/** `assign(sourceId, familyId)` puts a Source in a family; a refusal is kept in `error` instead of an unhandled rejection. */
export function useAssignSource(instanceId: string) {
  const assignMutation = useMutation(api.creative_family_sources.assign);
  const [error, setError] = useState<string | null>(null);
  const assign = (sourceId: string, familyId: string) => {
    setError(null);
    assignMutation({ instanceId, sourceId: sourceId as Id<"sources">, familyId: familyId as Id<"creativeFamilies"> }).catch((e: unknown) =>
      setError(extractConvexErrorMessage(e, "Something went wrong")),
    );
  };
  return { assign, error };
}

export function RemoveFromFamilyButton({ instanceId, sourceId }: { instanceId: string; sourceId: string }) {
  const remove = useMutation(api.creative_family_sources.remove);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-1">
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setError(null);
          remove({ instanceId, sourceId: sourceId as Id<"sources"> }).catch((e: unknown) => setError(extractConvexErrorMessage(e, "Something went wrong")));
        }}
      >
        Remove from family
      </Button>
      {error ? <p role="alert" className="m-0 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

export function AddSourceButton({ instanceId, familyId }: { instanceId: string; familyId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus />
        Add Source
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a Source</DialogTitle>
            <DialogDescription>Sources that belong to no family yet.</DialogDescription>
          </DialogHeader>
          {open ? <UnclassifiedPicker instanceId={instanceId} familyId={familyId} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function UnclassifiedPicker({ instanceId, familyId }: { instanceId: string; familyId: string }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.creative_families.listUnclassified,
    { instanceId },
    { initialNumItems: PAGE_SIZE },
  ) as { results: ClassifiableSource[]; status: string; loadMore: (numItems: number) => void };
  const { assign, error } = useAssignSource(instanceId);
  useThumbnailRequests(instanceId, results);
  if (status === "LoadingFirstPage") return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (results.length === 0) return <p className="text-sm text-muted-foreground">No unclassified Sources.</p>;
  return (
    <div className="grid max-h-96 gap-3 overflow-y-auto">
      {error ? <p role="alert" className="m-0 text-sm text-destructive">{error}</p> : null}
      <ul className="grid gap-2">
        {results.map((source) => (
          <li key={source._id} className="flex items-center gap-3">
            <SourceThumbnail source={source} className="size-12" />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{sourceTitle(source)}</span>
            <Button
              type="button"
              variant="outline"
              onClick={() => assign(source._id, familyId)}
            >
              Add
            </Button>
          </li>
        ))}
      </ul>
      {status === "CanLoadMore" ? (
        <Button type="button" variant="outline" className="w-fit" onClick={() => loadMore(PAGE_SIZE)}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}
