// Form state of a Production Recipe version (issue #143) and its conversion
// to the arguments of `production_recipes.create` / `saveVersion`.

export type RecipeVersionContent = {
  prompt?: string;
  instructions: string;
  constraints: string[];
  variables: { name: string; values: string[]; default?: string }[];
};

export type VariableDraft = { name: string; values: string; default: string };
export type RecipeDraft = { prompt: string; instructions: string; constraints: string; variables: VariableDraft[] };

const lines = (text: string): string[] => text.split("\n").map((l) => l.trim()).filter((l) => l !== "");

export const emptyDraft = (): RecipeDraft => ({ prompt: "", instructions: "", constraints: "", variables: [] });

export function draftFromVersion(version: RecipeVersionContent): RecipeDraft {
  return {
    prompt: version.prompt ?? "",
    instructions: version.instructions,
    constraints: version.constraints.join("\n"),
    variables: version.variables.map((v) => ({ name: v.name, values: v.values.join("\n"), default: v.default ?? "" })),
  };
}

/** Server arguments of a draft; blank prompt and blank default are omitted. */
export function contentFromDraft(draft: RecipeDraft): RecipeVersionContent {
  const prompt = draft.prompt.trim();
  return {
    ...(prompt ? { prompt } : {}),
    instructions: draft.instructions.trim(),
    constraints: lines(draft.constraints),
    variables: draft.variables.map((v) => {
      const def = v.default.trim();
      return { name: v.name.trim(), values: lines(v.values), ...(def ? { default: def } : {}) };
    }),
  };
}
