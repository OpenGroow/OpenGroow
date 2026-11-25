"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Sparkles } from "lucide-react";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";

// Recipe Generation from a Creative Family (ADR-087, ticket #194): the action that asks the Strategy Agent for a
// proposal, and the five latest generations with their state. States come from the Runs, nothing is stored here.

/**
 * Mirrors `MAX_INSTRUCTIONS_LENGTH` of apps/convex/recipe_generation_shared.ts (the dashboard only maps the
 * `@convex` modules it needs in tsconfig; the server enforces the limit).
 */
const MAX_INSTRUCTIONS_LENGTH = 2000;

export type Generation = {
  generationId: string;
  /** The Run to review and create from. */
  runId: string;
  createdAt: number;
  tryCount: number;
  instructions?: string;
  state: "in_progress" | "ready_to_review" | "no_opportunity" | "failed" | "created" | "recipe_deleted";
  reason?: string;
  details?: string;
  /** The validated Recipe Proposal, for the review form. */
  proposal?: unknown;
  recipeId?: string;
};
type Generations = { generations: Generation[]; inFlight: boolean };

const NO_OPPORTUNITY_REASONS: Record<string, string> = {
  sources_insufficient: "The Sources are not enough to propose a Recipe.",
  already_covered: "Existing Recipes already cover this family.",
  no_compatible_mission_type: "No Mission type accepts a Recipe for this mechanic.",
  low_relevance: "Nothing relevant enough was found.",
};

const STATES: Record<Generation["state"], { label: string; tone: "progress" | "info" | "neutral" | "error" | "active" }> = {
  in_progress: { label: "In progress", tone: "progress" },
  ready_to_review: { label: "Ready to review", tone: "info" },
  no_opportunity: { label: "No opportunity", tone: "neutral" },
  failed: { label: "Failed", tone: "error" },
  created: { label: "Created", tone: "active" },
  recipe_deleted: { label: "Recipe deleted", tone: "neutral" },
};

const dateTime = (value: number): string => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(value);

/** Reads the generations of a family: shared by the action and the list so both agree on "in flight". */
export function useGenerations(instanceId: string, familyId: string): Generations | undefined {
  return useQuery(api.recipe_generation_views.listGenerations, { instanceId, familyId: familyId as Id<"creativeFamilies"> }) as Generations | undefined;
}

export function GenerateRecipeButton({ instanceId, familyId, familyName }: { instanceId: string; familyId: string; familyName: string }) {
  const generations = useGenerations(instanceId, familyId);
  const [open, setOpen] = React.useState(false);
  const inFlight = generations?.inFlight === true;
  return (
    <>
      <Button type="button" variant="outline" disabled={inFlight} onClick={() => setOpen(true)}>
        <Sparkles className="size-4" />
        {inFlight ? "Generation in progress" : "Generate Recipe"}
      </Button>
      <GenerateRecipeDialog instanceId={instanceId} familyId={familyId} familyName={familyName} open={open} onOpenChange={setOpen} />
    </>
  );
}

function GenerateRecipeDialog({
  instanceId,
  familyId,
  familyName,
  open,
  onOpenChange,
}: {
  instanceId: string;
  familyId: string;
  familyName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const generate = useMutation(api.recipe_generation.generateRecipe);
  const [instructions, setInstructions] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const wasOpen = React.useRef(open);

  React.useEffect(() => {
    if (open && !wasOpen.current) {
      setInstructions("");
      setError(null);
    }
    wasOpen.current = open;
  }, [open]);

  const length = instructions.trim().length;
  const tooLong = length > MAX_INSTRUCTIONS_LENGTH;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || tooLong) return;
    setSubmitting(true);
    setError(null);
    try {
      const text = instructions.trim();
      await generate({ instanceId, familyId: familyId as Id<"creativeFamilies">, ...(text ? { instructions: text } : {}) });
      // The generation keeps running when the modal closes; its state shows in the family.
      onOpenChange(false);
    } catch (submitError: unknown) {
      setError(extractConvexErrorMessage(submitError, "Failed to start the generation"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate Recipe</DialogTitle>
          <DialogDescription>{`The Strategy Agent studies the Sources of ${familyName} and proposes a Production Recipe for you to review.`}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="generation-instructions">Additional instructions (optional)</Label>
            <Textarea id="generation-instructions" value={instructions} rows={5} aria-invalid={tooLong} onChange={(e) => setInstructions(e.target.value)} />
            <p className={tooLong ? "m-0 text-xs text-destructive" : "m-0 text-xs text-muted-foreground"} role={tooLong ? "alert" : undefined}>
              {tooLong
                ? `Too long: ${length} characters, the limit is ${MAX_INSTRUCTIONS_LENGTH}.`
                : `${length} / ${MAX_INSTRUCTIONS_LENGTH} characters. Closing this window does not stop the generation.`}
            </p>
          </div>
          {error ? <p role="alert" className="m-0 break-words text-sm text-destructive [overflow-wrap:anywhere]">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={submitting || tooLong}>
              Generate Recipe
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The five latest generations of the family, one row each (retries are hidden). `onReview` receives the generation
 * (Run id and proposal) of a row to review.
 */
export function FamilyGenerations({ instanceId, familyId, onReview }: { instanceId: string; familyId: string; onReview: (generation: Generation) => void }) {
  const data = useGenerations(instanceId, familyId);
  if (data === undefined || data.generations.length === 0) return null;
  return (
    <section aria-label="Recipe generations" className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <h2 className="m-0 text-lg font-semibold text-foreground">Generations</h2>
      <ul className="m-0 grid grid-cols-[minmax(0,1fr)] gap-3 p-0">
        {data.generations.map((generation) => (
          <li key={generation.generationId} className="min-w-0">
            <GenerationRow generation={generation} onReview={onReview} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function GenerationRow({ generation, onReview }: { generation: Generation; onReview: (generation: Generation) => void }) {
  const { label, tone } = STATES[generation.state];
  const explanation =
    generation.state === "no_opportunity"
      ? [NO_OPPORTUNITY_REASONS[generation.reason ?? ""] ?? generation.reason, generation.details].filter(Boolean).join(" ")
      : generation.state === "failed"
        ? generation.reason
        : undefined;
  return (
    <Card className="flex flex-col gap-1 px-5 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone={tone} label={label} />
        <span className="text-sm text-muted-foreground tabular-nums">{dateTime(generation.createdAt)}</span>
        {(generation.state === "ready_to_review" || (generation.state === "created" && generation.proposal !== undefined)) ? (
          <Button type="button" size="sm" variant={generation.state === "created" ? "outline" : "default"} className="ml-auto" onClick={() => onReview(generation)}>
            {generation.state === "created" ? "View proposal" : "Review"}
          </Button>
        ) : null}
      </div>
      {explanation ? <p className={generation.state === "failed" ? "m-0 break-words text-sm text-destructive [overflow-wrap:anywhere]" : "m-0 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]"}>{explanation}</p> : null}
      {generation.instructions ? <p className="m-0 truncate text-sm text-muted-foreground">{`Instructions: ${generation.instructions}`}</p> : null}
    </Card>
  );
}
