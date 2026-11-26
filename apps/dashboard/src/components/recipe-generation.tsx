"use client";

import * as React from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ArrowRight, Check, Info, Layers, Sparkles, SquarePlay } from "lucide-react";
import { SearchField } from "@/components/opengroow/filter-bar";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  ready_to_review: { label: "Ready", tone: "info" },
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

export function GenerateRecipeButton({ instanceId, label = "Generate Recipe", variant = "default" }: { instanceId: string; label?: string; variant?: "default" | "outline" }) {
  const generations = useGenerations(instanceId);
  const [open, setOpen] = React.useState(false);
  const inFlight = generations?.inFlight === true;
  return (
    <>
      <Button type="button" variant={variant} disabled={inFlight} onClick={() => setOpen(true)}>
        <Sparkles className="size-4" />
        {inFlight ? "Generation in progress" : label}
      </Button>
      <GenerateRecipeDialog instanceId={instanceId} open={open} onOpenChange={setOpen} />
    </>
  );
}

type FamilyChoice = { _id: string; name: string; status: "active" | "archived"; sourceCount: number; sourceCountCapped: boolean };
type SourceChoice = { _id: string; label: string; status: string; excluded?: boolean; origin: string; marketing: { summary?: string } };

function Step({ n, title, optional, hint, children }: { n: number; title: string; optional?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3" aria-label={title}>
      <div className="grid gap-1">
        <h3 className="m-0 flex items-center gap-3 text-base font-semibold text-foreground">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary/20 text-sm font-semibold text-primary">{n}</span>
          {title}
          {optional ? <span className="font-semibold text-foreground">(optional)</span> : null}
        </h3>
        {hint ? <p className="m-0 text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function PickRow({ label, count, checked, onToggle, ariaLabel }: { label: string; count?: number | string; checked: boolean; onToggle: () => void; ariaLabel: string }) {
  return (
    <li className={checked ? "rounded-lg bg-primary/10" : "border-b border-border last:border-b-0"}>
      <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm">
        <Checkbox checked={checked} onCheckedChange={onToggle} aria-label={ariaLabel} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count !== undefined ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{count}</span> : null}
      </label>
    </li>
  );
}

/** Optional inspiration: Creative Families (a shortcut to their recent Sources) or Sources, one tab each. */
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
  const [tab, setTab] = React.useState<"families" | "sources">("families");
  const [search, setSearch] = React.useState("");
  const needle = search.trim().toLowerCase();
  const toggle = (list: string[], id: string, set: (ids: string[]) => void) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const titleOf = (source: SourceChoice) => source.marketing.summary ?? source.origin;
  const familyRows = (families ?? []).filter((f) => f.status === "active" && f.sourceCount > 0 && f.name.toLowerCase().includes(needle));
  const sourceRows = results.filter((s) => s.status === "ready" && s.excluded !== true && titleOf(s).toLowerCase().includes(needle));
  const selected = familyIds.length + sourceIds.length;
  const tabButton = (id: "families" | "sources", label: string, Icon: typeof Layers) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => {
        setTab(id);
        setSearch("");
      }}
      className={
        tab === id
          ? "flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
          : "flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
      }
    >
      <Icon aria-hidden="true" className="size-4" />
      {label}
    </button>
  );
  return (
    <div className="grid gap-3 rounded-xl border border-border p-3">
      <div role="tablist" aria-label="Inspiration" className="grid grid-cols-2 gap-2">
        {tabButton("families", "Creative Families", Layers)}
        {tabButton("sources", "Sources", SquarePlay)}
      </div>
      <SearchField value={search} onChange={setSearch} label={tab === "families" ? "Search creative families" : "Search sources"} placeholder={tab === "families" ? "Search creative families…" : "Search sources…"} className="w-full" />
      {tab === "families" ? (
        familyRows.length === 0 ? (
          <p className="m-0 py-4 text-center text-sm text-muted-foreground">{families === undefined ? "Loading…" : "No Creative Family."}</p>
        ) : (
          <ul className="m-0 grid max-h-52 list-none overflow-y-auto p-0">
            {familyRows.map((family) => (
              <PickRow
                key={family._id}
                label={family.name}
                count={family.sourceCountCapped ? `${family.sourceCount}+` : family.sourceCount}
                checked={familyIds.includes(family._id)}
                onToggle={() => toggle(familyIds, family._id, onFamilies)}
                ariaLabel={`Family ${family.name}`}
              />
            ))}
          </ul>
        )
      ) : status === "LoadingFirstPage" ? (
        <p className="m-0 py-4 text-center text-sm text-muted-foreground">Loading…</p>
      ) : sourceRows.length === 0 ? (
        <p className="m-0 py-4 text-center text-sm text-muted-foreground">No Source is ready yet.</p>
      ) : (
        <ul className="m-0 grid max-h-52 list-none overflow-y-auto p-0">
          {sourceRows.map((source) => (
            <PickRow key={source._id} label={titleOf(source)} checked={sourceIds.includes(source._id)} onToggle={() => toggle(sourceIds, source._id, onSources)} ariaLabel={`Source ${titleOf(source)}`} />
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between gap-3">
        {selected > 0 ? (
          <span className="flex items-center gap-2 rounded-lg bg-primary/15 px-3 py-1.5 text-sm font-semibold text-primary">
            <Check aria-hidden="true" className="size-4" />
            {selected} selected
          </span>
        ) : (
          <span />
        )}
        {tab === "sources" && status === "CanLoadMore" ? (
          <Button type="button" variant="link" className="h-auto p-0 text-primary" onClick={() => loadMore(25)}>
            Show more sources <ArrowRight aria-hidden="true" className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
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
  const blocked = submitting || tooLong || tooManySources || !hasInput;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked) return;
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
      <DialogContent className="max-h-[92vh] w-[min(94vw,44rem)] max-w-none overflow-y-auto">
        <DialogHeader className="flex flex-row items-center gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Sparkles aria-hidden="true" className="size-6" />
          </span>
          <div className="grid gap-1">
            <DialogTitle className="text-2xl">Generate Recipe</DialogTitle>
            <DialogDescription>The Strategy Agent proposes a Production Recipe from your idea and inspiration, for you to review.</DialogDescription>
          </div>
        </DialogHeader>
        <form className="grid gap-6" onSubmit={handleSubmit}>
          <Step n={1} title="Core idea" hint="e.g. a content format, story angle, theme, or creative experiment.">
            <Textarea id="generation-idea" aria-label="Core idea" value={idea} rows={3} placeholder="Describe the content pattern or creative idea you want to explore…" onChange={(e) => setIdea(e.target.value)} />
          </Step>
          <div className="border-t border-border" />
          <Step n={2} title="Inspiration" optional hint="Creative Families are shortcuts to recent Sources, such as recurring formats, themes, or styles.">
            <InspirationPicker instanceId={instanceId} sourceIds={sourceIds} familyIds={familyIds} onSources={setSourceIds} onFamilies={setFamilyIds} />
            {tooManySources ? (
              <p role="alert" className="m-0 text-sm text-destructive">{`${sourceIds.length} Sources are selected, a generation reads at most ${MAX_GENERATION_SOURCES}: unselect some.`}</p>
            ) : familyIds.length > 0 ? (
              <p className="m-0 text-xs text-muted-foreground">{`The generation reads at most ${MAX_GENERATION_SOURCES} Sources: yours first, then the most recent of the selected families.`}</p>
            ) : null}
          </Step>
          <div className="border-t border-border" />
          <Step n={3} title="Additional instructions" optional>
            <Textarea
              id="generation-instructions"
              aria-label="Additional instructions"
              value={instructions}
              rows={3}
              aria-invalid={tooLong}
              placeholder="Add constraints, tone, target audience, or anything the agent should keep in mind…"
              onChange={(e) => setInstructions(e.target.value)}
            />
            <p className={tooLong ? "m-0 text-xs text-destructive" : "m-0 text-xs text-muted-foreground"} role={tooLong ? "alert" : undefined}>
              {tooLong
                ? `Too long: ${length} characters, the limit is ${MAX_INSTRUCTIONS_LENGTH}.`
                : `${length} / ${MAX_INSTRUCTIONS_LENGTH} characters. Closing this window does not stop the generation.`}
            </p>
          </Step>
          {error ? <p role="alert" className="m-0 break-words text-sm text-destructive [overflow-wrap:anywhere]">{error}</p> : null}
          <DialogFooter className="items-center border-t border-border pt-4 sm:justify-between">
            <p className="m-0 flex items-center gap-2 text-sm text-muted-foreground">
              {!hasInput ? (
                <>
                  <Info aria-hidden="true" className="size-4 shrink-0" />
                  Write an idea or select at least one source.
                </>
              ) : null}
            </p>
            <div className="flex gap-3">
              <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={submitting} disabled={blocked}>
                Generate Recipe
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** What a generation is called in the history: the name of its proposal, else its idea. */
const titleOfGeneration = (generation: Generation): string => {
  const name = (generation.proposal as { name?: unknown } | undefined)?.name;
  return typeof name === "string" && name !== "" ? name : (generation.idea ?? "Recipe generation");
};

const HISTORY_SHOWN = 3;

/**
 * The latest generations of the Project as a compact panel, one row each (retries are hidden): its state, what it
 * was about, its date and the action that fits (review a proposal, view a created one, read why it failed).
 * `onReview` receives the generation (Run id and proposal) of a row to review.
 */
export function GenerationHistory({ instanceId, onReview }: { instanceId: string; onReview: (generation: Generation) => void }) {
  const data = useGenerations(instanceId);
  const [all, setAll] = React.useState(false);
  const generations = data?.generations ?? [];
  const shown = all ? generations : generations.slice(0, HISTORY_SHOWN);
  return (
    <section aria-label="Generation History" className="grid min-w-0 content-start gap-3 rounded-2xl border border-border bg-card p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-xl font-semibold text-foreground">Generation History</h2>
        {generations.length > HISTORY_SHOWN ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setAll((value) => !value)}>
            {all ? "Show fewer" : "View all"}
            {all ? null : <ArrowRight aria-hidden="true" className="size-4" />}
          </Button>
        ) : null}
      </div>
      {data === undefined ? (
        <p className="m-0 text-sm text-muted-foreground">Loading…</p>
      ) : generations.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">No generation yet. Your proposals appear here to review.</p>
      ) : (
        <ul className="m-0 grid min-w-0 list-none p-0">
          {shown.map((generation) => (
            <GenerationRow key={generation.generationId} generation={generation} onReview={onReview} />
          ))}
        </ul>
      )}
    </section>
  );
}

function GenerationRow({ generation, onReview }: { generation: Generation; onReview: (generation: Generation) => void }) {
  const [details, setDetails] = React.useState(false);
  const { label, tone } = STATES[generation.state];
  const explanation =
    generation.state === "no_opportunity"
      ? [NO_OPPORTUNITY_REASONS[generation.reason ?? ""] ?? generation.reason, generation.details].filter(Boolean).join(" ")
      : generation.state === "failed"
        ? generation.reason
        : undefined;
  const hasProposal = generation.proposal !== undefined;
  return (
    <li className="min-w-0 border-b border-border py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <StatusBadge tone={tone} label={label} />
        <span className="min-w-0 flex-1 basis-40 truncate text-sm font-medium text-foreground" title={titleOfGeneration(generation)}>
          {titleOfGeneration(generation)}
        </span>
        <span className="text-sm text-muted-foreground tabular-nums">{dateTime(generation.createdAt)}</span>
        {generation.state === "ready_to_review" ? (
          <Button type="button" size="sm" onClick={() => onReview(generation)}>
            Review
          </Button>
        ) : generation.state === "created" && hasProposal ? (
          <Button type="button" size="sm" variant="outline" onClick={() => onReview(generation)}>
            View
          </Button>
        ) : explanation ? (
          <Button type="button" size="sm" variant="outline" aria-expanded={details} onClick={() => setDetails((open) => !open)}>
            Details
          </Button>
        ) : null}
      </div>
      {details && explanation ? (
        <p className={generation.state === "failed" ? "m-0 mt-2 break-words text-sm text-destructive [overflow-wrap:anywhere]" : "m-0 mt-2 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]"}>{explanation}</p>
      ) : null}
      {generation.idea && hasProposal ? <p className="m-0 mt-1 truncate text-xs text-muted-foreground">{`Idea: ${generation.idea}`}</p> : null}
    </li>
  );
}
