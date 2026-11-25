"use client";

import * as React from "react";
import { CheckCircle2, ChevronDown, ListChecks, ListOrdered, ScrollText, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";
import { contentFromDraft, draftFromVersion, emptyDraft, recipeTargetLabel, type RecipeDraft, type RecipeTarget, type RecipeVersionContent } from "@/src/lib/production-recipe-form";

// Create a Production Recipe or edit it (an edit saves the next version).
// Server refusals are shown as is.

type Props = {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: RecipeVersionContent;
  /** The Mission types a new recipe can be written for (create mode). */
  targets?: RecipeTarget[];
  /** Create mode: values the form opens with (a Recipe Proposal to review). Every field stays editable. */
  prefill?: { name: string; description: string; templateId: string; missionType: string };
  /** Replaces the default dialog title. */
  title?: string;
  /** Create mode: a wide two-column review layout (the form on the left, read-only `aside` insights on the right). */
  review?: { subtitle: string; aside: React.ReactNode };
  onSubmit: (fields: { name: string; description: string; templateId: string; missionType: string } & RecipeVersionContent) => void | Promise<void>;
};

/** A collapsed-by-default section of the production guidelines; its field stays mounted so the form keeps its value. */
export function GuidelineRow({ icon: Icon, label, summary, defaultOpen = false, children }: { icon: React.ComponentType<{ className?: string }>; label: string; summary: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="border-b border-border last:border-b-0">
      <Button type="button" variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="h-auto w-full justify-start gap-3 rounded-none px-4 py-3 text-sm">
        <Icon className="size-4 text-muted-foreground" />
        <span className="font-medium text-foreground">{label}</span>
        <span className="ml-auto text-muted-foreground">{summary}</span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </Button>
      <div hidden={!open} className="grid gap-2 px-4 pb-4">
        {children}
      </div>
    </div>
  );
}

export function ProductionRecipeFormDialog({ mode, open, onOpenChange, initial, targets = [], prefill, title, review, onSubmit }: Props) {
  const [name, setName] = React.useState(prefill?.name ?? "");
  const [description, setDescription] = React.useState(prefill?.description ?? "");
  const [targetIndex, setTargetIndex] = React.useState("");
  const [draft, setDraft] = React.useState<RecipeDraft>(() => (initial ? draftFromVersion(initial) : emptyDraft()));
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const wasOpen = React.useRef(open);

  React.useEffect(() => {
    if (open && !wasOpen.current) {
      setName(prefill?.name ?? "");
      setDescription(prefill?.description ?? "");
      setTargetIndex("");
      setDraft(initial ? draftFromVersion(initial) : emptyDraft());
      setError(null);
    }
    wasOpen.current = open;
  }, [open, initial, prefill]);

  // The Mission types may load after the form opened: preselect the proposal's one once known.
  React.useEffect(() => {
    if (!open || !prefill || targetIndex !== "") return;
    const index = targets.findIndex((t) => t.templateId === prefill.templateId && t.missionType === prefill.missionType);
    if (index >= 0) setTargetIndex(String(index));
  }, [open, prefill, targets, targetIndex]);

  const set = (patch: Partial<RecipeDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const disabled = submitting || draft.instructions.trim() === "" || (mode === "create" && (name.trim() === "" || description.trim() === "" || targetIndex === ""));

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const target = targets[Number(targetIndex)];
      await onSubmit({ name: name.trim().replace(/\s+/g, " "), description: description.trim(), templateId: target?.templateId ?? "", missionType: target?.missionType ?? "", ...contentFromDraft(draft) });
      onOpenChange(false);
    } catch (submitError: unknown) {
      setError(extractConvexErrorMessage(submitError, "Failed to save the Production Recipe"));
    } finally {
      setSubmitting(false);
    }
  }

  if (mode === "create" && review) {
    const steps = draft.instructions.split("\n").filter((l) => l.trim() !== "").length;
    const rules = draft.constraints.split("\n").filter((l) => l.trim() !== "").length;
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] w-[min(94vw,64rem)] overflow-x-hidden overflow-y-auto">
          <form className="grid gap-5" noValidate onSubmit={handleSubmit}>
            <DialogHeader className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Sparkles className="size-5" />
              </span>
              <div className="grid gap-0.5">
                <DialogTitle>{title ?? "Review recipe"}</DialogTitle>
                <DialogDescription>{review.subtitle}</DialogDescription>
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label="Close" className="ml-auto" onClick={() => onOpenChange(false)}>
                <X className="size-4" />
              </Button>
            </DialogHeader>
            <div className="grid gap-6 border-t border-border pt-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="grid min-w-0 content-start gap-5">
                <h3 className="m-0 text-base font-semibold text-foreground">Recipe details</h3>
                <div className="grid gap-2">
                  <Label htmlFor="recipe-name">Name</Label>
                  <Input id="recipe-name" value={name} required onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="recipe-description">Description</Label>
                  <Textarea id="recipe-description" value={description} required rows={3} onChange={(e) => setDescription(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="recipe-target">Mission type</Label>
                  <NativeSelect id="recipe-target" value={targetIndex} required onChange={(e) => setTargetIndex(e.target.value)}>
                    <option value="">Choose a Mission type</option>
                    {targets.map((t, i) => (
                      <option key={`${t.templateId}:${t.missionType}`} value={String(i)}>
                        {recipeTargetLabel(t)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <h3 className="m-0 mt-2 text-base font-semibold text-foreground">Production guidelines</h3>
                <div className="rounded-lg border border-border">
                  <GuidelineRow icon={ScrollText} label="Prompt" summary={draft.prompt.trim() ? "Set" : "Optional"}>
                    <Textarea id="recipe-prompt" aria-label="Prompt" value={draft.prompt} rows={4} onChange={(e) => set({ prompt: e.target.value })} />
                    <p className="m-0 text-xs text-muted-foreground">Sent unchanged, with values written in full. Optional.</p>
                  </GuidelineRow>
                  <GuidelineRow icon={ListOrdered} label="Instructions" summary={`${steps} ${steps === 1 ? "step" : "steps"}`} defaultOpen={draft.instructions.trim() === ""}>
                    <Textarea id="recipe-instructions" aria-label="Instructions" value={draft.instructions} required rows={8} onChange={(e) => set({ instructions: e.target.value })} />
                  </GuidelineRow>
                  <GuidelineRow icon={ListChecks} label="Constraints" summary={`${rules} ${rules === 1 ? "rule" : "rules"}`}>
                    <Textarea id="recipe-constraints" aria-label="Constraints" value={draft.constraints} rows={6} onChange={(e) => set({ constraints: e.target.value })} />
                    <p className="m-0 text-xs text-muted-foreground">One constraint per line.</p>
                  </GuidelineRow>
                </div>
              </div>
              <aside className="min-w-0 content-start rounded-xl bg-background/60 p-4">{review.aside}</aside>
            </div>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <div className="flex items-center gap-3 border-t border-border pt-4">
              {targetIndex !== "" ? (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="size-4 text-status-success" /> Production target validated
                </span>
              ) : null}
              <DialogFooter className="ml-auto">
                <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={disabled}>
                  Create recipe
                </Button>
              </DialogFooter>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title ?? (mode === "create" ? "New Production Recipe" : "Edit Production Recipe")}</DialogTitle>
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
              <div className="grid gap-2">
                <Label htmlFor="recipe-target">Mission type</Label>
                <NativeSelect id="recipe-target" value={targetIndex} required onChange={(e) => setTargetIndex(e.target.value)}>
                  <option value="">Choose a Mission type</option>
                  {targets.map((t, i) => (
                    <option key={`${t.templateId}:${t.missionType}`} value={String(i)}>
                      {recipeTargetLabel(t)}
                    </option>
                  ))}
                </NativeSelect>
                {targets.length === 0 ? <p className="m-0 text-xs text-muted-foreground">No installed Template can consume a recipe yet.</p> : null}
              </div>
            </>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="recipe-prompt">Prompt</Label>
            <Textarea id="recipe-prompt" value={draft.prompt} rows={4} onChange={(e) => set({ prompt: e.target.value })} />
            <p className="m-0 text-xs text-muted-foreground">Sent unchanged, with values written in full. Optional.</p>
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
