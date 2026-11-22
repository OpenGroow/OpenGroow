"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

// Merge a Creative Family into another (ADR-082). The server moves at most 100
// Sources per call; this repeats the call until none remain, and calling it
// again after an interruption resumes.

type MergeStep = { moved: number; remaining: number };
type FamilyOption = { _id: string; name: string; status: "active" | "archived" };

/** Calls `step` until the server reports nothing left; returns the Sources moved. */
export async function runMerge(step: () => Promise<MergeStep>): Promise<number> {
  let moved = 0;
  for (;;) {
    const result = await step();
    moved += result.moved;
    if (result.remaining === 0) return moved;
  }
}

export function MergeFamilyButton({ instanceId, familyId, familyName }: { instanceId: string; familyId: string; familyName: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Merge into…
      </Button>
      {open ? <MergeFamilyDialog instanceId={instanceId} familyId={familyId} familyName={familyName} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function MergeFamilyDialog({
  instanceId,
  familyId,
  familyName,
  onClose,
}: {
  instanceId: string;
  familyId: string;
  familyName: string;
  onClose: () => void;
}) {
  const families = useQuery(api.creative_families.list, { instanceId }) as FamilyOption[] | undefined;
  const merge = useMutation(api.creative_family_merge.merge);
  const [targetId, setTargetId] = React.useState("");
  const [moved, setMoved] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const selectId = React.useId();
  const targets = (families ?? []).filter((f) => f._id !== familyId && f.status === "active");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!targetId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const total = await runMerge(() =>
        merge({ instanceId, fromFamilyId: familyId as Id<"creativeFamilies">, intoFamilyId: targetId as Id<"creativeFamilies"> }),
      );
      setMoved(total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The merge failed. Run it again to resume.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (!next && !busy ? onClose() : undefined)} disablePointerDismissal={busy}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge {familyName}</DialogTitle>
          <DialogDescription>
            Moves every Source of this family into another one, then archives this family. No Source is deleted.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor={selectId}>Destination family</Label>
            <NativeSelect id={selectId} aria-label="Destination family" value={targetId} onChange={(e) => setTargetId(e.target.value)} disabled={busy || moved !== null}>
              <option value="">Choose a family</option>
              {targets.map((f) => (
                <option key={f._id} value={f._id}>
                  {f.name}
                </option>
              ))}
            </NativeSelect>
          </div>
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
