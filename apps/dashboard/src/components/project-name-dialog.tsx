"use client";

import * as React from "react";
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

export const PROJECT_NAME_MAX_LENGTH = 60;

type ProjectNameDialogProps = {
  mode: "create" | "rename";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  onSubmit: (name: string) => void | Promise<void>;
};

export function ProjectNameDialog({
  mode,
  open,
  onOpenChange,
  initialName,
  onSubmit,
}: ProjectNameDialogProps) {
  const [name, setName] = React.useState(initialName ?? "");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const wasOpenRef = React.useRef(open);

  React.useEffect(() => {
    if (open && !wasOpenRef.current) {
      setName(initialName ?? "");
      setError(null);
    }
    wasOpenRef.current = open;
  }, [open, initialName]);

  const trimmedName = name.trim();
  const submitDisabled =
    isSubmitting || !trimmedName || trimmedName.length > PROJECT_NAME_MAX_LENGTH;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitDisabled) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmedName);
      onOpenChange(false);
    } catch (submitError: unknown) {
      setError(
        submitError instanceof Error ? submitError.message : "Failed to save the project name",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Name your project" : "Rename project"}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Give this project a name you'll recognize later."
              : "Update the name shown for this project."}
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="project-name">Project name</Label>
            <Input
              id="project-name"
              value={name}
              placeholder="e.g. Marketing Ops"
              maxLength={PROJECT_NAME_MAX_LENGTH}
              autoFocus
              required
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          {error ? <p className="text-sm text-[#7e3d35]">{error}</p> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitDisabled}>
              {isSubmitting
                ? mode === "create"
                  ? "Creating…"
                  : "Renaming…"
                : mode === "create"
                  ? "Create project"
                  : "Save name"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
