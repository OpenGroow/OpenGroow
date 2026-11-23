"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CheckSquare, Ellipsis, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CreativeFamilyFormDialog } from "@/src/components/creative-family-form-dialog";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";

// The "more actions" menu of a Creative Family: Edit, Select and Delete (ADR-082). Delete archives
// the family: its Sources stay, it is no longer listed, and it cannot receive new ones.
// An archived family reached by a link offers Restore instead.

export function FamilyMoreMenu({
  instanceId,
  family,
  archived,
  onSelect,
}: {
  instanceId: string;
  family: { _id: string; name: string; description: string };
  archived: boolean;
  /** Starts the selection of the family's Sources. */
  onSelect: () => void;
}) {
  const update = useMutation(api.creative_family_details.update);
  const archive = useMutation(api.creative_families_archive.archive);
  const unarchive = useMutation(api.creative_families_archive.unarchive);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleArchived() {
    setError(null);
    try {
      await (archived ? unarchive : archive)({ instanceId, familyId: family._id as Id<"creativeFamilies"> });
    } catch (e) {
      setError(extractConvexErrorMessage(e, "Could not update the family."));
    }
  }

  return (
    <div className="flex items-center gap-3">
      {error ? <span role="alert" className="text-sm text-destructive">{error}</span> : null}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="More actions" />}>
          <Ellipsis />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <Pencil />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onSelect}>
            <CheckSquare />
            Select
          </DropdownMenuItem>
          {archived ? (
            <DropdownMenuItem onClick={() => void toggleArchived()}>
              <RotateCcw />
              Restore
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem className="text-status-error" onClick={() => void toggleArchived()}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <CreativeFamilyFormDialog
        mode="edit"
        open={editing}
        onOpenChange={setEditing}
        initial={{ name: family.name, description: family.description }}
        onSubmit={async (fields) => {
          await update({ instanceId, familyId: family._id as Id<"creativeFamilies">, ...fields });
        }}
      />
    </div>
  );
}
