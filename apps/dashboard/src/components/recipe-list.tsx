"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Play } from "lucide-react";
import { Card } from "@/components/ui/card";
import { recipeTargetLabel, type RecipeTarget } from "@/src/lib/production-recipe-form";

// The Project's Production Recipes, on the Recipes page (issue #143, ADR-088).

type RecipeRow = { _id: string; templateId: string; missionType: string; name: string; description: string; status: "active" | "archived"; latestVersion: number };

export function RecipeList({ instanceId }: { instanceId: string }) {
  const recipes = useQuery(api.production_recipes.list, { instanceId }) as RecipeRow[] | undefined;
  const targets = useQuery(api.production_recipes.listTargets, { instanceId }) as RecipeTarget[] | undefined;
  const targetLabel = (r: RecipeRow) => {
    const t = targets?.find((x) => x.templateId === r.templateId && x.missionType === r.missionType);
    return t ? recipeTargetLabel(t) : r.missionType;
  };
  return (
    <section aria-label="Production Recipes" className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <h2 className="m-0 text-lg font-semibold text-foreground">Production Recipes</h2>
      {recipes === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : recipes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recipes yet. Create one, or generate one from an idea.</p>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
          {recipes.map((recipe) => (
            <li key={recipe._id}>
              <Card className="relative flex flex-col items-start gap-1 px-5 py-3 transition-colors hover:bg-surface-raised has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring">
                <div className="flex max-w-full items-center gap-3">
                  <Link
                    href={`/projects/${encodeURIComponent(instanceId)}/recipes/${encodeURIComponent(recipe._id)}`}
                    className="w-fit max-w-full truncate text-base font-semibold text-foreground outline-none after:absolute after:inset-0 after:content-['']"
                  >
                    {recipe.name}
                  </Link>
                  <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary tabular-nums">{`v${recipe.latestVersion}`}</span>
                </div>
                <span className="max-w-full truncate text-sm text-muted-foreground">{recipe.description}</span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Play aria-hidden="true" className="size-3" />
                  {targetLabel(recipe)}
                </span>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
