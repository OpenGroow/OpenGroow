// Form state of a Production Recipe version (issue #143) and its conversion
// to the arguments of `production_recipes.create` / `saveVersion`.

export type RecipeVersionContent = {
  prompt?: string;
  instructions: string;
  constraints: string[];
};

export type RecipeDraft = { prompt: string; instructions: string; constraints: string };

const lines = (text: string): string[] => text.split("\n").map((l) => l.trim()).filter((l) => l !== "");

export const emptyDraft = (): RecipeDraft => ({ prompt: "", instructions: "", constraints: "" });

export function draftFromVersion(version: RecipeVersionContent): RecipeDraft {
  return {
    prompt: version.prompt ?? "",
    instructions: version.instructions,
    constraints: version.constraints.join("\n"),
  };
}

/** Server arguments of a draft; blank prompt and blank default are omitted. */
export function contentFromDraft(draft: RecipeDraft): RecipeVersionContent {
  const prompt = draft.prompt.trim();
  return {
    ...(prompt ? { prompt } : {}),
    instructions: draft.instructions.trim(),
    constraints: lines(draft.constraints),
  };
}

/** A Mission type a recipe can be written for (`production_recipes.listTargets`). */
export type RecipeTarget = { templateId: string; templateName: string; missionType: string; label: string };

export const recipeTargetLabel = (t: RecipeTarget): string => `${t.templateName} · ${t.label}`;
