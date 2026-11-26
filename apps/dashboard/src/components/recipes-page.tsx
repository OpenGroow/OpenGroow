"use client";

import { use, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/opengroow/page-header";
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

export function RecipesContent({ instanceId }: { instanceId: string }) {
  const targets = useQuery(api.production_recipes.listTargets, { instanceId }) as RecipeTarget[] | undefined;
  const create = useMutation(api.production_recipes.create);
  const [creating, setCreating] = useState(false);
  const [reviewed, setReviewed] = useState<Generation | null>(null);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
      <PageHeader
        title="Recipes"
        description="How your Missions are produced: write a Production Recipe yourself, or ask the Strategy Agent to propose one from an idea and Sources."
        action={
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              Create Recipe
            </Button>
            <GenerateRecipeButton instanceId={instanceId} />
          </div>
        }
      />
      <GenerationHistory instanceId={instanceId} onReview={setReviewed} />
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
