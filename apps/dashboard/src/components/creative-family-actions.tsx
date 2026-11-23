"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreativeFamilyFormDialog } from "@/src/components/creative-family-form-dialog";

// Header button that creates a Creative Family (ADR-082, issue #130).

export function NewFamilyButton({ instanceId }: { instanceId: string }) {
  const [open, setOpen] = useState(false);
  const create = useMutation(api.creative_family_details.create);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        New family
      </Button>
      <CreativeFamilyFormDialog
        mode="create"
        open={open}
        onOpenChange={setOpen}
        onSubmit={async (fields) => {
          await create({ instanceId, ...fields });
        }}
      />
    </>
  );
}
