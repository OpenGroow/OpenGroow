// Pure, deterministic resolution of a Recipe Version (issue #137). No Convex
// imports, no LLM call: plain `{NAME}` substitution.

export type RecipeVariable = { name: string; values: string[]; default?: string };

export type RecipeContent = {
  prompt?: string;
  instructions: string;
  constraints: string[];
  variables: RecipeVariable[];
};

export type RecipeChoices = {
  /** Explicit values, by variable name. */
  values?: Record<string, string>;
  /** Variables to draw at random (only when not given explicitly). */
  vary?: string[];
  /** Controlled random source in [0, 1); defaults to Math.random. */
  random?: () => number;
};

export type ResolvedRecipe = {
  prompt?: string;
  instructions: string;
  constraints: string[];
  /** The value used for every variable. */
  values: Record<string, string>;
};

const NAME_PATTERN = "[A-Za-z_][A-Za-z0-9_]*";
const NAME = new RegExp(`^${NAME_PATTERN}$`);
// Name-shaped tokens only: `{}`, `{ }` or JSON-like braces are literal text.
const PLACEHOLDER = new RegExp(`\\{(${NAME_PATTERN})\\}`, "g");

/** Distinct placeholder names of a text, in order of first appearance. */
export function placeholdersOf(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) if (!names.includes(m[1]!)) names.push(m[1]!);
  return names;
}

/** Throws when a version could not be resolved: the save-time rules. */
export function validateRecipeContent(content: RecipeContent): void {
  const declared = new Set<string>();
  for (const variable of content.variables) {
    if (!NAME.test(variable.name)) throw new Error(`Invalid variable name "${variable.name}"`);
    if (declared.has(variable.name)) throw new Error(`Variable "${variable.name}" is declared twice`);
    declared.add(variable.name);
    if (variable.values.length === 0) throw new Error(`Variable "${variable.name}" needs at least one value`);
    if (new Set(variable.values).size !== variable.values.length) throw new Error(`Variable "${variable.name}" lists a value twice`);
    if (variable.default !== undefined && !variable.values.includes(variable.default)) {
      throw new Error(`Default "${variable.default}" of variable "${variable.name}" is not one of its values`);
    }
  }
  for (const text of [content.prompt ?? "", content.instructions]) {
    for (const name of placeholdersOf(text)) {
      if (!declared.has(name)) throw new Error(`Placeholder {${name}} has no matching variable`);
    }
  }
}

function substitute(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER, (whole, name: string) => values[name] ?? whole);
}

/** Explicit value, else a draw if named in `vary`, else the default. */
export function resolveRecipeVersion(content: RecipeContent, choices: RecipeChoices): ResolvedRecipe {
  const byName = new Map(content.variables.map((v) => [v.name, v]));
  const explicit = choices.values ?? {};
  const vary = choices.vary ?? [];
  for (const name of [...Object.keys(explicit), ...vary]) {
    if (!byName.has(name)) throw new Error(`Unknown variable "${name}"`);
  }
  const random = choices.random ?? Math.random;
  const values: Record<string, string> = {};
  for (const variable of content.variables) {
    let value: string | undefined;
    if (variable.name in explicit) value = explicit[variable.name];
    else if (vary.includes(variable.name)) value = variable.values[Math.min(variable.values.length - 1, Math.floor(random() * variable.values.length))];
    else value = variable.default;
    if (value === undefined) throw new Error(`Variable "${variable.name}" has no value and no default`);
    if (!variable.values.includes(value)) throw new Error(`Value "${value}" is not allowed for variable "${variable.name}"`);
    values[variable.name] = value;
  }
  return {
    ...(content.prompt === undefined ? {} : { prompt: substitute(content.prompt, values) }),
    instructions: substitute(content.instructions, values),
    constraints: content.constraints,
    values,
  };
}
