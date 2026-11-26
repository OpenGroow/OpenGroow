"use client";

import * as React from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Sparkles } from "lucide-react";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { extractConvexErrorMessage } from "@/src/lib/convex-error";

// Recipe Generation (ADR-087, ADR-088): asks the Strategy Agent for a proposal from a free idea and/or optional
// inspiration (Sources, or Creative Families as a shortcut that selects several), and lists the latest generations
// with their state. States come from the Runs, nothing is stored here.

/**
 * Mirror `MAX_INSTRUCTIONS_LENGTH` and `MAX_GENERATION_SOURCES` of apps/convex/recipe_generation_shared.ts (the
 * dashboard only maps the `@convex` modules it needs in tsconfig; the server enforces both limits).
 */
const MAX_INSTRUCTIONS_LENGTH = 2000;
const MAX_GENERATION_SOURCES = 25;

export type Generation = {
  generationId: string;
  /** The Run to review and create from. */
  runId: string;
  createdAt: number;
  tryCount: number;
  idea?: string;
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
  already_covered: "Existing Recipes already cover this idea.",
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

/** Reads the generations of the Project: shared by the action and the history so both agree on "in flight". */
export function useGenerations(instanceId: string): Generations | undefined {
  return useQuery(api.recipe_generation_views.listGenerations, { instanceId }) as Generations | undefined;
}

export function GenerateRecipeButton({ instanceId }: { instanceId: string }) {
  const generations = useGenerations(instanceId);
  const [open, setOpen] = React.useState(false);
  const inFlight = generations?.inFlight === true;
  return (
    <>
      <Button type="button" disabled={inFlight} onClick={() => setOpen(true)}>
        <Sparkles className="size-4" />
        {inFlight ? "Generation in progress" : "Generate Recipe"}
      </Button>
      <GenerateRecipeDialog instanceId={instanceId} open={open} onOpenChange={setOpen} />
    </>
  );
}

type FamilyChoice = { _id: string; name: string; status: "active" | "archived"; sourceCount: number; sourceCountCapped: boolean };
type SourceChoice = { _id: string; label: string; status: string; excluded?: boolean; origin: string; marketing: { summary?: string } };

/** Optional inspiration: Creative Families (a shortcut) and Sources the user can tick. */
function InspirationPicker({
  instanceId,
  sourceIds,
  familyIds,
  onSources,
  onFamilies,
}: {
  instanceId: string;
  sourceIds: string[];
  familyIds: string[];
  onSources: (ids: string[]) => void;
  onFamilies: (ids: string[]) => void;
}) {
  const families = useQuery(api.creative_families.list, { instanceId }) as FamilyChoice[] | undefined;
  const { results, status, loadMore } = usePaginatedQuery(api.sources.listByInstance, { instanceId }, { initialNumItems: 25 }) as {
    results: SourceChoice[];
    status: string;
    loadMore: (numItems: number) => void;
  };
  const toggle = (list: string[], id: string, set: (ids: string[]) => void) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const readable = results.filter((s) => s.status === "ready" && s.excluded !== true);
  const activeFamilies = (families ?? []).filter((f) => f.status === "active" && f.sourceCount > 0);
  return (
    <fieldset className="grid gap-3 border-0 p-0">
      <legend className="p-0 text-sm font-medium text-foreground">Inspiration (optional)</legend>
      {activeFamilies.length > 0 ? (
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">Creative Families: their most recent Sources are selected.</span>
          <ul className="m-0 grid max-h-32 list-none gap-1 overflow-y-auto p-0">
            {activeFamilies.map((family) => (
              <li key={family._id}>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={familyIds.includes(family._id)} onCheckedChange={() => toggle(familyIds, family._id, onFamilies)} aria-label={`Family ${family.name}`} />
                  <span className="min-w-0 flex-1 truncate">{family.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{family.sourceCountCapped ? `${family.sourceCount}+` : family.sourceCount}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="grid gap-1">
        <span className="text-xs text-muted-foreground">Sources</span>
        {status === "LoadingFirstPage" ? (
          <p className="m-0 text-sm text-muted-foreground">Loading…</p>
        ) : readable.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">No Source is ready yet.</p>
        ) : (
          <ul className="m-0 grid max-h-44 list-none gap-1 overflow-y-auto p-0">
            {readable.map((source) => (
              <li key={source._id}>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={sourceIds.includes(source._id)} onCheckedChange={() => toggle(sourceIds, source._id, onSources)} aria-label={`Source ${source.marketing.summary ?? source.origin}`} />
                  <span className="min-w-0 flex-1 truncate">{source.marketing.summary ?? source.origin}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {status === "CanLoadMore" ? (
          <Button type="button" variant="link" className="h-auto w-fit p-0" onClick={() => loadMore(25)}>
            Show more Sources
          </Button>
        ) : null}
      </div>
    </fieldset>
  );
}

function GenerateRecipeDialog({ instanceId, open, onOpenChange }: { instanceId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const generate = useMutation(api.recipe_generation.generateRecipe);
  const [idea, setIdea] = React.useState("");
  const [instructions, setInstructions] = React.useState("");
  const [sourceIds, setSourceIds] = React.useState<string[]>([]);
  const [familyIds, setFamilyIds] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const wasOpen = React.useRef(open);

  React.useEffect(() => {
    if (open && !wasOpen.current) {
      setIdea("");
      setInstructions("");
      setSourceIds([]);
      setFamilyIds([]);
      setError(null);
    }
    wasOpen.current = open;
  }, [open]);

  const length = instructions.trim().length;
  const tooLong = length > MAX_INSTRUCTIONS_LENGTH;
  const tooManySources = sourceIds.length > MAX_GENERATION_SOURCES;
  const hasInput = idea.trim() !== "" || sourceIds.length > 0 || familyIds.length > 0;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || tooLong || tooManySources || !hasInput) return;
    setSubmitting(true);
    setError(null);
    try {
      const text = instructions.trim();
      const ideaText = idea.trim();
      await generate({
        instanceId,
        ...(ideaText ? { idea: ideaText } : {}),
        ...(sourceIds.length > 0 ? { sourceIds: sourceIds as Id<"sources">[] } : {}),
        ...(familyIds.length > 0 ? { familyIds: familyIds as Id<"creativeFamilies">[] } : {}),
        ...(text ? { instructions: text } : {}),
      });
      // The generation keeps running when the modal closes; its state shows in the history.
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
          <DialogDescription>The Strategy Agent proposes a Production Recipe from your idea and the inspiration you choose, for you to review.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="generation-idea">Idea</Label>
            <Textarea id="generation-idea" value={idea} rows={3} placeholder="What do you want to try?" onChange={(e) => setIdea(e.target.value)} />
          </div>
          <InspirationPicker instanceId={instanceId} sourceIds={sourceIds} familyIds={familyIds} onSources={setSourceIds} onFamilies={setFamilyIds} />
          {tooManySources ? (
            <p role="alert" className="m-0 text-sm text-destructive">{`${sourceIds.length} Sources are selected, a generation reads at most ${MAX_GENERATION_SOURCES}: unselect some.`}</p>
          ) : familyIds.length > 0 ? (
            <p className="m-0 text-xs text-muted-foreground">{`The generation reads at most ${MAX_GENERATION_SOURCES} Sources: yours first, then the most recent of the selected families.`}</p>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="generation-instructions">Additional instructions (optional)</Label>
            <Textarea id="generation-instructions" value={instructions} rows={3} aria-invalid={tooLong} onChange={(e) => setInstructions(e.target.value)} />
            <p className={tooLong ? "m-0 text-xs text-destructive" : "m-0 text-xs text-muted-foreground"} role={tooLong ? "alert" : undefined}>
              {tooLong
                ? `Too long: ${length} characters, the limit is ${MAX_INSTRUCTIONS_LENGTH}.`
                : `${length} / ${MAX_INSTRUCTIONS_LENGTH} characters. Closing this window does not stop the generation.`}
            </p>
          </div>
          {!hasInput ? <p className="m-0 text-xs text-muted-foreground">Write an idea or choose at least one Source.</p> : null}
          {error ? <p role="alert" className="m-0 break-words text-sm text-destructive [overflow-wrap:anywhere]">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={submitting || tooLong || tooManySources || !hasInput}>
              Generate Recipe
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The latest generations of the Project, one row each (retries are hidden). `onReview` receives the generation
 * (Run id and proposal) of a row to review.
 */
export function GenerationHistory({ instanceId, onReview }: { instanceId: string; onReview: (generation: Generation) => void }) {
  const data = useGenerations(instanceId);
  if (data === undefined || data.generations.length === 0) return null;
  return (
    <section aria-label="Generation History" className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <h2 className="m-0 text-lg font-semibold text-foreground">Generation History</h2>
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
      {generation.idea ? <p className="m-0 truncate text-sm text-muted-foreground">{`Idea: ${generation.idea}`}</p> : null}
      {generation.instructions ? <p className="m-0 truncate text-sm text-muted-foreground">{`Instructions: ${generation.instructions}`}</p> : null}
    </Card>
  );
}
