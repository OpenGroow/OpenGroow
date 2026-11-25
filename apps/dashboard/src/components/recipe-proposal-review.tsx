"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Film, Sparkles } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProductionRecipeFormDialog } from "@/src/components/production-recipe-form-dialog";
import type { Generation } from "@/src/components/recipe-generation";
import { cn } from "@/lib/utils";
import { recipeTargetLabel, type RecipeTarget } from "@/src/lib/production-recipe-form";

// Review of a Recipe Proposal (ADR-087, ticket #195): the existing Production Recipe form, prefilled and editable,
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
        <CitedSources instanceId={instanceId} runId={generation.runId} />
      </div>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="font-semibold text-foreground">{label}</dt>
      <dd className="m-0 whitespace-pre-wrap text-muted-foreground">{value}</dd>
    </div>
  );
}

export function RecipeProposalReview({
  instanceId,
  familyId,
  familyName,
  generation,
  onClose,
}: {
  instanceId: string;
  familyId: string;
  /** Shown as "Generated from …" in the review header. */
  familyName?: string;
  /** The generation under review; null when the review is closed. */
  generation: Generation | null;
  onClose: () => void;
}) {
  const targets = useQuery(api.production_recipes.listTargets, { instanceId }) as RecipeTarget[] | undefined;
  const create = useMutation(api.production_recipes.create);
  const proposal = generation ? proposalOf(generation) : undefined;
  if (!generation || !proposal) return null;

  if (generation.recipeId) {
    const recipeHref = `/projects/${encodeURIComponent(instanceId)}/library/${encodeURIComponent(familyId)}/recipes/${encodeURIComponent(generation.recipeId)}`;
    const target = targets?.find((t) => t.templateId === proposal.templateId && t.missionType === proposal.missionType);
    return (
      <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
        <DialogContent className="max-h-[92vh] w-[min(94vw,56rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{proposal.name}</DialogTitle>
            <DialogDescription>A Production Recipe was already created from this proposal.</DialogDescription>
          </DialogHeader>
          <ProposalContext instanceId={instanceId} generation={generation} proposal={proposal} />
          <dl className="m-0 grid gap-3 text-sm">
            <ReadOnlyField label="Description" value={proposal.description} />
            <ReadOnlyField label="Mission type" value={target ? recipeTargetLabel(target) : proposal.missionType} />
            {proposal.prompt ? <ReadOnlyField label="Prompt" value={proposal.prompt} /> : null}
            <ReadOnlyField label="Instructions" value={proposal.instructions} />
            {proposal.constraints.length > 0 ? <ReadOnlyField label="Constraints" value={proposal.constraints.join("\n")} /> : null}
          </dl>
          <DialogFooter>
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
      review={{ subtitle: familyName ? `Generated from ${familyName}` : "Generated from this Creative Family", aside: <ProposalContext instanceId={instanceId} generation={generation} proposal={proposal} /> }}
      targets={targets}
      initial={{ ...(proposal.prompt ? { prompt: proposal.prompt } : {}), instructions: proposal.instructions, constraints: proposal.constraints }}
      prefill={{ name: proposal.name, description: proposal.description, templateId: proposal.templateId, missionType: proposal.missionType }}
      onSubmit={async (fields) => {
        await create({ instanceId, familyId: familyId as Id<"creativeFamilies">, ...fields, proposalRunId: generation.runId as Id<"runs"> });
      }}
    />
  );
}
