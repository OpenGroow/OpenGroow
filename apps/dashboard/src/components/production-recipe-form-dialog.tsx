"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import { contentFromDraft, draftFromVersion, emptyDraft, type RecipeDraft, type RecipeVersionContent } from "@/src/lib/production-recipe-form";

// Create a Production Recipe or edit it (an edit saves the next version).
// Server refusals (bad placeholder, default outside values) are shown as is.

type Props = {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: RecipeVersionContent;
  onSubmit: (fields: { name: string; description: string } & RecipeVersionContent) => void | Promise<void>;
};

export function ProductionRecipeFormDialog({ mode, open, onOpenChange, initial, onSubmit }: Props) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [draft, setDraft] = React.useState<RecipeDraft>(() => (initial ? draftFromVersion(initial) : emptyDraft()));
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const wasOpen = React.useRef(open);

  React.useEffect(() => {
    if (open && !wasOpen.current) {
      setName("");
      setDescription("");
      setDraft(initial ? draftFromVersion(initial) : emptyDraft());
      setError(null);
    }
    wasOpen.current = open;
  }, [open, initial]);

  const set = (patch: Partial<RecipeDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setVariable = (index: number, patch: Partial<RecipeDraft["variables"][number]>) =>
    set({ variables: draft.variables.map((v, i) => (i === index ? { ...v, ...patch } : v)) });

  const disabled = submitting || draft.instructions.trim() === "" || (mode === "create" && (name.trim() === "" || description.trim() === ""));

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ name: name.trim().replace(/\s+/g, " "), description: description.trim(), ...contentFromDraft(draft) });
      onOpenChange(false);
    } catch (submitError: unknown) {
      setError(extractConvexErrorMessage(submitError, "Failed to save the Production Recipe"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New Production Recipe" : "Edit Production Recipe"}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Describe how to reproduce this family's mechanic."
              : "Saving appends a new version. Earlier versions are never changed."}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          {mode === "create" ? (
            <>
              <div className="grid gap-2">
                <Label htmlFor="recipe-name">Name</Label>
                <Input id="recipe-name" value={name} required autoFocus onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="recipe-description">Description</Label>
                <Textarea id="recipe-description" value={description} required rows={2} onChange={(e) => setDescription(e.target.value)} />
              </div>
            </>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="recipe-prompt">Prompt</Label>
            <Textarea id="recipe-prompt" value={draft.prompt} rows={4} onChange={(e) => set({ prompt: e.target.value })} />
            <p className="m-0 text-xs text-muted-foreground">Sent unchanged. Use {"{NAME}"} for a variable placeholder. Optional.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="recipe-instructions">Instructions</Label>
            <Textarea id="recipe-instructions" value={draft.instructions} required rows={4} onChange={(e) => set({ instructions: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="recipe-constraints">Constraints</Label>
            <Textarea id="recipe-constraints" value={draft.constraints} rows={3} onChange={(e) => set({ constraints: e.target.value })} />
            <p className="m-0 text-xs text-muted-foreground">One constraint per line.</p>
          </div>
          <fieldset className="grid gap-3 border-0 p-0">
            <legend className="mb-2 text-sm font-medium text-foreground">Variables</legend>
            {draft.variables.map((variable, i) => (
              <div key={i} className="grid gap-2 rounded-lg border border-border p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <Label htmlFor={`variable-name-${i}`}>Variable name</Label>
                    <Input id={`variable-name-${i}`} value={variable.name} onChange={(e) => setVariable(i, { name: e.target.value })} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`variable-default-${i}`}>Default value</Label>
                    <Input id={`variable-default-${i}`} value={variable.default} onChange={(e) => setVariable(i, { default: e.target.value })} />
                  </div>
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`variable-values-${i}`}>Allowed values (one per line)</Label>
                  <Textarea id={`variable-values-${i}`} value={variable.values} rows={3} onChange={(e) => setVariable(i, { values: e.target.value })} />
                </div>
                <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() => set({ variables: draft.variables.filter((_, j) => j !== i) })}>
                  <Trash2 className="size-4" />
                  Remove variable
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => set({ variables: [...draft.variables, { name: "", values: "", default: "" }] })}>
              <Plus className="size-4" />
              Add variable
            </Button>
          </fieldset>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={disabled}>
              {mode === "create" ? "Create recipe" : "Save new version"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
