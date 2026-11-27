"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { NativeSelect } from "@/components/ui/native-select";

type RecipeId = Id<"productionRecipes">;
type OfferedRecipe = { _id: RecipeId; name: string; isDefault?: boolean; latestVersion?: number };

/** The `<option>`s of a recipe list: the Default is marked, and a version is shown when the list carries it. */
export function RecipeOptions({ recipes }: { recipes: readonly OfferedRecipe[] }) {
  return recipes.map((r) => (
    <option key={r._id} value={r._id}>
      {r.name}
      {r.isDefault ? " (Default)" : ""}
      {r.latestVersion !== undefined ? ` (v${r.latestVersion})` : ""}
    </option>
  ));
}

/**
 * The recipe choice of a creative Mission type (ADR-091): the recipes written for the Template and Mission type, the
 * Default preselected when there is one and nothing preselected otherwise. A choice that no longer belongs to the
 * offered list (the type changed, the recipe was deleted) falls back to the Default, never to another recipe.
 * `chosenRecipeId` is "" while the user still has to choose, which `recipeMissing` reports.
 */
export function useRecipeChoice(args: { instanceId: string; templateId: string; type: string; isCreative: boolean; enabled: boolean }) {
  const { instanceId, templateId, type, isCreative, enabled } = args;
  const [recipeId, setRecipeId] = useState<RecipeId | "">("");
  const offeredRecipes = useQuery(
    api.production_recipes.listForMissionType,
    enabled && isCreative && templateId && type ? { instanceId, templateId, missionType: type } : "skip",
  );
  const chosenRecipeId: RecipeId | "" = !isCreative
    ? ""
    : offeredRecipes?.some((r) => r._id === recipeId)
      ? recipeId
      : (offeredRecipes?.find((r) => r.isDefault)?._id ?? "");
  return { offeredRecipes, chosenRecipeId, setRecipeId, recipeMissing: isCreative && chosenRecipeId === "" };
}

/** The recipe field of a create form: a select to choose from, or the reason none can be chosen. */
export function RecipeField(props: {
  recipes: readonly OfferedRecipe[] | undefined;
  value: RecipeId | "";
  onChange: (id: RecipeId) => void;
  testId?: string;
}) {
  const { recipes, value, onChange, testId } = props;
  if (!recipes) return null;
  if (recipes.length === 0) {
    return (
      <p className="rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground">
        This Mission type needs a Production Recipe and none is available. Update the Template or create a recipe first.
      </p>
    );
  }
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-semibold text-muted-foreground">Production Recipe</span>
      <NativeSelect {...(testId ? { "data-testid": testId } : {})} value={value} onChange={(e) => onChange(e.target.value as RecipeId)}>
        {value === "" ? (
          <option value="" disabled>
            Choose a recipe...
          </option>
        ) : null}
        <RecipeOptions recipes={recipes} />
      </NativeSelect>
    </label>
  );
}
