"use client";

import { use, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { BookOpen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductionRecipeFormDialog } from "@/src/components/production-recipe-form-dialog";
import { RecipeList } from "@/src/components/recipe-list";
import { GenerateRecipeButton, GenerationHistory, type Generation } from "@/src/components/recipe-generation";
import { RecipeProposalReview } from "@/src/components/recipe-proposal-review";
import type { RecipeTarget } from "@/src/lib/production-recipe-form";

// The Recipes workspace (ADR-088): where Production Recipes are created, generated, reviewed and deleted. A recipe
// depends on no Creative Family; Sources and families are only optional inspiration for a generation.

type Props = { params: Promise<{ instanceId: string }> };

export function RecipesPage({ params }: Props) {
  const { instanceId } = use(params);
  return <RecipesContent instanceId={decodeURIComponent(instanceId)} />;
}

/** A few stacked cards with a play button: the illustration of the "Build a new Recipe" panel. */
function BuildIllustration() {
  return (
    <svg aria-hidden="true" viewBox="0 0 160 140" className="h-36 w-40 shrink-0 text-primary max-sm:hidden">
      <rect x="6" y="28" width="86" height="96" rx="12" transform="rotate(-12 49 76)" fill="currentColor" opacity="0.18" />
      <rect x="22" y="22" width="92" height="100" rx="12" transform="rotate(-5 68 72)" fill="currentColor" opacity="0.28" />
      <rect x="40" y="20" width="108" height="104" rx="14" fill="currentColor" opacity="0.4" />
      <rect x="52" y="32" width="84" height="48" rx="8" fill="currentColor" opacity="0.5" />
      <path d="M86 44 L106 56 L86 68 Z" fill="white" opacity="0.9" />
      <rect x="52" y="90" width="64" height="6" rx="3" fill="white" opacity="0.6" />
      <rect x="52" y="104" width="44" height="6" rx="3" fill="white" opacity="0.4" />
    </svg>
  );
}

export function RecipesContent({ instanceId }: { instanceId: string }) {
  const targets = useQuery(api.production_recipes.listTargets, { instanceId }) as RecipeTarget[] | undefined;
  const create = useMutation(api.production_recipes.create);
  const [creating, setCreating] = useState(false);
  const [reviewed, setReviewed] = useState<Generation | null>(null);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
      <header className="flex flex-col items-start justify-between gap-5 lg:flex-row lg:items-center">
        <div className="flex min-w-0 items-center gap-5">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <BookOpen aria-hidden="true" className="size-8" />
          </span>
          <div className="grid min-w-0 gap-1">
            <h1 className="m-0 text-4xl font-bold tracking-tight text-foreground">Recipes</h1>
            <p className="m-0 max-w-2xl text-lg text-muted-foreground">Production Recipes are reusable creative methods to produce consistent, high-performing content.</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Button type="button" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Create Recipe
          </Button>
          <GenerateRecipeButton instanceId={instanceId} />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Build a new Recipe" className="flex items-center gap-6 rounded-2xl border border-border bg-gradient-to-br from-primary/20 to-card p-6">
          <BuildIllustration />
          <div className="grid min-w-0 gap-4">
            <div className="grid gap-2">
              <h2 className="m-0 text-2xl font-semibold text-foreground">Build a new Recipe</h2>
              <p className="m-0 text-base text-muted-foreground">Create one manually or let the Strategy Agent generate a proposal from an idea and your inspiration.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="outline" onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                Create manually
              </Button>
              <GenerateRecipeButton instanceId={instanceId} label="Generate with AI" />
            </div>
          </div>
        </section>
        <GenerationHistory instanceId={instanceId} onReview={setReviewed} />
      </div>

      <RecipeProposalReview instanceId={instanceId} generation={reviewed} onClose={() => setReviewed(null)} />
      <RecipeList instanceId={instanceId} />
      <ProductionRecipeFormDialog
        mode="create"
        open={creating}
        onOpenChange={setCreating}
        targets={targets}
        onSubmit={async (fields) => {
          await create({ instanceId, ...fields });
        }}
      />
    </div>
  );
}
