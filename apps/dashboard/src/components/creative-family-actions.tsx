"use client";

import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { CreativeFamilyFormDialog } from "@/src/components/creative-family-form-dialog";

// The dialog that creates a Creative Family, opened from the Library menu (ADR-082, issue #130).

export function NewFamilyDialog({
  instanceId,
  open,
  onOpenChange,
}: {
  instanceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useMutation(api.creative_family_details.create);
  return (
    <CreativeFamilyFormDialog
      mode="create"
      open={open}
      onOpenChange={onOpenChange}
      onSubmit={async (fields) => {
        await create({ instanceId, ...fields });
      }}
    />
  );
}
