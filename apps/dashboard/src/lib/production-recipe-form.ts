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

/** The confirmation before deleting a recipe: what goes with it (its Planned Contents not produced yet) and what stays. */
export function recipeDeletionMessage(plannedContents: number): string {
  const planned = plannedContents === 0
    ? ""
    : ` ${plannedContents} planned ${plannedContents === 1 ? "content that is" : "contents that are"} not produced yet will also be deleted.`;
  return `Permanently delete this Production Recipe and its versions?${planned} Missions already created with it, their Publications and their performance are kept.`;
}

export const recipeTargetLabel = (t: RecipeTarget): string => `${t.templateName} · ${t.label}`;
