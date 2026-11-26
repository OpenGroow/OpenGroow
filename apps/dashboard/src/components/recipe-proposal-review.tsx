"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Film, ListChecks, ListOrdered, ScrollText, Sparkles, X } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GuidelineRow, ProductionRecipeFormDialog } from "@/src/components/production-recipe-form-dialog";
import type { Generation } from "@/src/components/recipe-generation";
import { cn } from "@/lib/utils";
import { recipeTargetLabel, type RecipeTarget } from "@/src/lib/production-recipe-form";

// Review of a Recipe Proposal (ADR-087, ticket #195, ADR-088): the existing Production Recipe form, prefilled and editable,
// with the rationale and cited Sources read-only. Cancel writes nothing; Save creates the Recipe from the proposal's Run.

export type RecipeProposal = {
  name: string;
  description: string;
  templateId: string;
  missionType: string;
  prompt?: string;
  instructions: string;
  constraints: string[];
  rationale: string;
  sourceIds?: string[];
};

type CitedSource = { sourceId: string; title: string };

/** The proposal of a generation, or undefined when it holds none (or an unexpected shape). */
export function proposalOf(generation: Generation): RecipeProposal | undefined {
  const p = generation.proposal as Partial<RecipeProposal> | undefined;
  if (!p || typeof p.name !== "string" || typeof p.instructions !== "string") return undefined;
  return { ...p, name: p.name, instructions: p.instructions, description: p.description ?? "", templateId: p.templateId ?? "", missionType: p.missionType ?? "", constraints: p.constraints ?? [], rationale: p.rationale ?? "" };
}

const VISIBLE_SOURCES = 4;

function CitedSources({ instanceId, runId }: { instanceId: string; runId: string }) {
  const sources = useQuery(api.recipe_generation_views.proposalSources, { instanceId, runId: runId as Id<"runs"> }) as CitedSource[] | undefined;
  const [all, setAll] = React.useState(false);
  const shown = sources && !all ? sources.slice(0, VISIBLE_SOURCES) : sources;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <div className="flex items-center justify-between">
        <h4 className="m-0 text-sm font-semibold text-foreground">Inspiration sources</h4>
        {sources ? <span className="text-sm text-muted-foreground">{sources.length}</span> : null}
      </div>
      {sources === undefined ? (
        <p className="m-0 text-sm text-muted-foreground">Loading…</p>
      ) : sources.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">The cited Sources are no longer available.</p>
      ) : (
        <ul className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-1 p-0">
          {shown?.map((source) => (
            <li key={source.sourceId}>
              <Link href={`/projects/${encodeURIComponent(instanceId)}/sources/${encodeURIComponent(source.sourceId)}`} target="_blank" className="flex items-center gap-3 rounded-lg p-2 text-sm text-foreground hover:bg-card">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-card text-muted-foreground">
                  <Film className="size-4" />
                </span>
                <span className="min-w-0 flex-1 truncate">{source.title}</span>
                <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {sources && sources.length > VISIBLE_SOURCES ? (
        <Button type="button" variant="link" className="h-auto w-fit p-0" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer sources" : `View all ${sources.length} sources`}
        </Button>
      ) : null}
    </div>
  );
}

/** The read-only "Creative insights" of a proposal: why it exists and the Sources it draws from. */
function ProposalContext({ instanceId, generation, proposal }: { instanceId: string; generation: Generation; proposal: RecipeProposal }) {
  const [fullRationale, setFullRationale] = React.useState(false);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <h3 className="m-0 flex items-center gap-2 text-base font-semibold text-foreground">
        <Sparkles className="size-4 text-primary" /> Creative insights
      </h3>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
        <h4 className="m-0 text-sm font-semibold text-foreground">Why this recipe?</h4>
        <p className={cn("m-0 whitespace-pre-wrap break-words text-sm text-muted-foreground", !fullRationale && "line-clamp-5")}>{proposal.rationale}</p>
        <Button type="button" variant="link" className="h-auto w-fit p-0" onClick={() => setFullRationale((v) => !v)}>
          {fullRationale ? "View less" : "View more"}
        </Button>
      </div>
      <div className="border-t border-border pt-4">
        {proposal.sourceIds && proposal.sourceIds.length > 0 ? <CitedSources instanceId={instanceId} runId={generation.runId} /> : <p className="m-0 text-sm text-muted-foreground">Generated from your idea, with no Source.</p>}
      </div>
    </div>
  );
}

function ReadOnlyField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-sm font-medium text-foreground">{label}</dt>
      <dd className="m-0 whitespace-pre-wrap break-words rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">{children}</dd>
    </div>
  );
}

const countLines = (text: string) => text.split("\n").filter((line) => line.trim() !== "").length;

export function RecipeProposalReview({
  instanceId,
  generation,
  onClose,
}: {
  instanceId: string;
  /** The generation under review; null when the review is closed. */
  generation: Generation | null;
  onClose: () => void;
}) {
  const targets = useQuery(api.production_recipes.listTargets, { instanceId }) as RecipeTarget[] | undefined;
  const create = useMutation(api.production_recipes.create);
  const proposal = generation ? proposalOf(generation) : undefined;
  if (!generation || !proposal) return null;

  if (generation.recipeId) {
    const recipeHref = `/projects/${encodeURIComponent(instanceId)}/recipes/${encodeURIComponent(generation.recipeId)}`;
    const target = targets?.find((t) => t.templateId === proposal.templateId && t.missionType === proposal.missionType);
    return (
      <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
        <DialogContent className="max-h-[92vh] w-[min(94vw,64rem)] overflow-x-hidden overflow-y-auto">
          <DialogHeader className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Sparkles className="size-5" />
            </span>
            <div className="grid gap-0.5">
              <DialogTitle>{proposal.name}</DialogTitle>
              <DialogDescription>A Production Recipe was already created from this proposal.</DialogDescription>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="Close" className="ml-auto" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </DialogHeader>
          <div className="grid gap-6 border-t border-border pt-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <dl className="m-0 grid min-w-0 content-start gap-5">
              <h3 className="m-0 text-base font-semibold text-foreground">Recipe details</h3>
              <ReadOnlyField label="Name">{proposal.name}</ReadOnlyField>
              <ReadOnlyField label="Description">{proposal.description}</ReadOnlyField>
              <ReadOnlyField label="Mission type">{target ? recipeTargetLabel(target) : proposal.missionType}</ReadOnlyField>
              <h3 className="m-0 mt-2 text-base font-semibold text-foreground">Production guidelines</h3>
              <div className="rounded-lg border border-border">
                <GuidelineRow icon={ScrollText} label="Prompt" summary={proposal.prompt ? "Set" : "None"}>
                  <p className="m-0 whitespace-pre-wrap break-words text-sm text-muted-foreground">{proposal.prompt || "No prompt."}</p>
                </GuidelineRow>
                <GuidelineRow icon={ListOrdered} label="Instructions" summary={`${countLines(proposal.instructions)} steps`}>
                  <p className="m-0 whitespace-pre-wrap break-words text-sm text-muted-foreground">{proposal.instructions}</p>
                </GuidelineRow>
                <GuidelineRow icon={ListChecks} label="Constraints" summary={`${proposal.constraints.length} rules`}>
                  <p className="m-0 whitespace-pre-wrap break-words text-sm text-muted-foreground">{proposal.constraints.join("\n") || "No constraints."}</p>
                </GuidelineRow>
              </div>
            </dl>
            <aside className="min-w-0 content-start rounded-xl bg-background/60 p-4">
              <ProposalContext instanceId={instanceId} generation={generation} proposal={proposal} />
            </aside>
          </div>
          <DialogFooter className="border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Link href={recipeHref} className={buttonVariants()}>
              Open the Recipe
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <ProductionRecipeFormDialog
      mode="create"
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Review recipe"
      review={{ subtitle: "Generated from your idea and Sources", aside: <ProposalContext instanceId={instanceId} generation={generation} proposal={proposal} /> }}
      targets={targets}
      initial={{ ...(proposal.prompt ? { prompt: proposal.prompt } : {}), instructions: proposal.instructions, constraints: proposal.constraints }}
      prefill={{ name: proposal.name, description: proposal.description, templateId: proposal.templateId, missionType: proposal.missionType }}
      onSubmit={async (fields) => {
        await create({ instanceId, ...fields, proposalRunId: generation.runId as Id<"runs"> });
      }}
    />
  );
}
