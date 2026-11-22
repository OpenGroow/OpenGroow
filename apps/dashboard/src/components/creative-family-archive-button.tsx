"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";

// Archives or unarchives a Creative Family (ADR-082). An archived family is
// no longer offered as a destination; its Sources stay listed under it.

export function CreativeFamilyArchiveButton({
  instanceId,
  familyId,
  archived,
}: {
  instanceId: string;
  familyId: string;
  archived: boolean;
}) {
  const archive = useMutation(api.creative_families_archive.archive);
  const unarchive = useMutation(api.creative_families_archive.unarchive);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setPending(true);
    setError(null);
    try {
      await (archived ? unarchive : archive)({ instanceId, familyId: familyId as Id<"creativeFamilies"> });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the family.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {error ? <span role="alert" className="text-sm text-destructive">{error}</span> : null}
      <Button type="button" variant="outline" disabled={pending} onClick={toggle}>
        {archived ? "Unarchive" : "Archive"}
      </Button>
    </div>
  );
}
