"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";

// Merge Creative Families into one of them (ADR-082), from the Library. The server moves at most 100
// Sources per call; this repeats the call until none remain, and calling it
// again after an interruption resumes.

type MergeStep = { moved: number; remaining: number };
export type MergeableFamily = { _id: string; name: string };

/** Calls `step` until the server reports nothing left; returns the Sources moved. */
export async function runMerge(step: () => Promise<MergeStep>): Promise<number> {
  let moved = 0;
  for (;;) {
    const result = await step();
    moved += result.moved;
    if (result.remaining === 0) return moved;
  }
}

export function MergeFamiliesDialog({
  instanceId,
  families,
  onClose,
  onDone,
}: {
  instanceId: string;
  /** The families the user selected: the destination is one of them. */
  families: MergeableFamily[];
  onClose: () => void;
  onDone: () => void;
}) {
  const merge = useMutation(api.creative_family_merge.merge);
  const [targetId, setTargetId] = React.useState("");
  const [moved, setMoved] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const selectId = React.useId();
  const target = families.find((f) => f._id === targetId);
  const others = families.filter((f) => f._id !== targetId);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      let total = 0;
      // One family after the other: each merge is resumable, so running it again after a failure picks up where it stopped.
      for (const from of others) {
        total += await runMerge(() =>
          merge({ instanceId, fromFamilyId: from._id as Id<"creativeFamilies">, intoFamilyId: target._id as Id<"creativeFamilies"> }),
        );
      }
      setMoved(total);
      onDone();
    } catch (e) {
      setError(extractConvexErrorMessage(e, "The merge failed. Run it again to resume."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (!next && !busy ? onClose() : undefined)} disablePointerDismissal={busy}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge {families.length} families</DialogTitle>
          <DialogDescription>
            Keeps one family and moves the Sources of the others into it, then archives the others. No Source is deleted.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor={selectId}>Family to keep</Label>
            <NativeSelect id={selectId} aria-label="Family to keep" value={targetId} onChange={(e) => setTargetId(e.target.value)} disabled={busy || moved !== null}>
              <option value="">Choose a family</option>
              {families.map((f) => (
                <option key={f._id} value={f._id}>
                  {f.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          {target ? (
            <p className="m-0 text-sm text-muted-foreground">
              {others.length} {others.length === 1 ? "family" : "families"} will be archived and their Sources moved into {target.name}.
            </p>
          ) : null}
          {busy ? <p role="status" className="m-0 text-sm text-muted-foreground">Merging…</p> : null}
          {moved !== null ? (
            <p role="status" className="m-0 text-sm text-foreground">
              Merged: {moved} {moved === 1 ? "Source" : "Sources"} moved.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="m-0 rounded-xl bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {moved !== null ? "Close" : "Cancel"}
            </Button>
            {moved === null ? (
              <Button type="submit" disabled={busy || !targetId}>
                {busy ? "Merging…" : error ? "Resume merge" : "Merge"}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
