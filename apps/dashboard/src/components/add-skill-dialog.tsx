"use client";

import * as React from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AddSkillDialogProps = {
  agentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the trimmed ClawHub skill spec. */
  onSubmit: (spec: string) => void | Promise<void>;
};

/**
 * Compact form to install an additional, user-chosen ClawHub Agent Skill
 * into an active Agent's workspace (issue #224). MVP has exactly one field
 * — the ClawHub skill name/package — and a warning that installing a skill
 * can change the Agent's behavior.
 */
export function AddSkillDialog({ agentName, open, onOpenChange, onSubmit }: AddSkillDialogProps) {
  const [spec, setSpec] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const wasOpenRef = React.useRef(open);
  const inputId = React.useId();

  React.useEffect(() => {
    if (open && !wasOpenRef.current) {
      setSpec("");
      setError(null);
    }
    wasOpenRef.current = open;
  }, [open]);

  const trimmedSpec = spec.trim();
  const submitDisabled = isSubmitting || trimmedSpec.length === 0;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitDisabled) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmedSpec);
      onOpenChange(false);
    } catch (err) {
      // Keep the dialog open, in place, and show the failure reason so the
      // user can see why the install failed and retry with the same value.
      setError(err instanceof Error ? err.message : "Failed to add skill.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, eventDetails) => {
        // Ignore Escape while a submission is in flight — otherwise the
        // dialog closes before onSubmit settles and a later failure sets
        // `error` on a dialog the user can no longer see.
        if (isSubmitting && !nextOpen && eventDetails.reason === "escape-key") return;
        onOpenChange(nextOpen);
      }}
      disablePointerDismissal={isSubmitting}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Skill — {agentName}</DialogTitle>
          <DialogDescription>
            Install an additional ClawHub Agent Skill into this Agent&apos;s workspace.
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <p className="m-0 flex items-start gap-2 rounded-xl bg-status-warning/10 px-4 py-3 text-sm leading-6 text-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-status-warning" />
            Installing a skill can change this Agent&apos;s behavior.
          </p>

          <div className="grid gap-2">
            <Label htmlFor={inputId}>ClawHub skill</Label>
            <Input
              id={inputId}
              value={spec}
              placeholder="e.g. avoid-ai-writing"
              required
              aria-required="true"
              onChange={(event) => setSpec(event.target.value)}
            />
          </div>

          {error && (
            <p
              role="alert"
              className="m-0 rounded-xl bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive"
            >
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitDisabled}>
              {isSubmitting ? "Adding…" : "Add Skill"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
