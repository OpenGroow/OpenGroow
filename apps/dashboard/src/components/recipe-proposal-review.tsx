"use client";

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProductionRecipeFormDialog } from "@/src/components/production-recipe-form-dialog";
import type { Generation } from "@/src/components/recipe-generation";
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

function CitedSources({ instanceId, runId }: { instanceId: string; runId: string }) {
  const sources = useQuery(api.recipe_generation_views.proposalSources, { instanceId, runId: runId as Id<"runs"> }) as CitedSource[] | undefined;
  return (
    <div className="grid gap-1">
      <h3 className="m-0 text-sm font-semibold text-foreground">Inspiration Sources</h3>
      {sources === undefined ? (
        <p className="m-0 text-sm text-muted-foreground">Loading…</p>
      ) : sources.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">The cited Sources are no longer available.</p>
      ) : (
        <ul className="m-0 grid gap-1 pl-5 text-sm">
          {sources.map((source) => (
            <li key={source.sourceId}>
              <Link href={`/projects/${encodeURIComponent(instanceId)}/sources/${encodeURIComponent(source.sourceId)}`} target="_blank" className="text-primary underline underline-offset-2">
                {source.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProposalContext({ instanceId, generation, proposal }: { instanceId: string; generation: Generation; proposal: RecipeProposal }) {
  return (
    <Card size="sm" className="gap-3 px-4">
      <div className="grid gap-1">
        <h3 className="m-0 text-sm font-semibold text-foreground">Rationale</h3>
        <p className="m-0 whitespace-pre-wrap text-sm text-muted-foreground">{proposal.rationale}</p>
      </div>
      <CitedSources instanceId={instanceId} runId={generation.runId} />
    </Card>
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
  generation,
  onClose,
}: {
  instanceId: string;
  familyId: string;
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
        <DialogContent className="max-h-[90vh] overflow-y-auto">
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
      title="Review Recipe Proposal"
      targets={targets}
      initial={{ ...(proposal.prompt ? { prompt: proposal.prompt } : {}), instructions: proposal.instructions, constraints: proposal.constraints }}
      prefill={{ name: proposal.name, description: proposal.description, templateId: proposal.templateId, missionType: proposal.missionType }}
      context={<ProposalContext instanceId={instanceId} generation={generation} proposal={proposal} />}
      onSubmit={async (fields) => {
        await create({ instanceId, familyId: familyId as Id<"creativeFamilies">, ...fields, proposalRunId: generation.runId as Id<"runs"> });
      }}
    />
  );
}
