"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProductionRecipeFormDialog } from "@/src/components/production-recipe-form-dialog";

// The Production Recipes of a Creative Family, on its detail page (issue #143).

type RecipeRow = { _id: string; name: string; description: string; status: "active" | "archived"; latestVersion: number };

export function FamilyRecipes({ instanceId, familyId, canCreate }: { instanceId: string; familyId: string; canCreate: boolean }) {
  const recipes = useQuery(api.production_recipes.list, { instanceId, familyId: familyId as Id<"creativeFamilies"> }) as RecipeRow[] | undefined;
  const create = useMutation(api.production_recipes.create);
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="Production Recipes" className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-lg font-semibold text-foreground">Production Recipes</h2>
        {canCreate ? (
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            New recipe
          </Button>
        ) : null}
      </div>
      {recipes === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : recipes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recipes yet.</p>
      ) : (
        <ul className="grid gap-3">
          {recipes.map((recipe) => (
            <li key={recipe._id}>
              <Card className="relative flex flex-col items-start gap-1 px-5 py-3 transition-colors hover:bg-surface-raised has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring">
                <div className="flex max-w-full items-center gap-3">
                  <Link
                    href={`/projects/${encodeURIComponent(instanceId)}/library/${encodeURIComponent(familyId)}/recipes/${encodeURIComponent(recipe._id)}`}
                    className="w-fit max-w-full truncate text-base font-semibold text-foreground outline-none after:absolute after:inset-0 after:content-['']"
                  >
                    {recipe.name}
                  </Link>
                  <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary tabular-nums">{`v${recipe.latestVersion}`}</span>
                </div>
                <span className="max-w-full truncate text-sm text-muted-foreground">{recipe.description}</span>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <ProductionRecipeFormDialog
        mode="create"
        open={open}
        onOpenChange={setOpen}
        onSubmit={async (fields) => {
          await create({ instanceId, familyId: familyId as Id<"creativeFamilies">, ...fields });
        }}
      />
    </section>
  );
}
