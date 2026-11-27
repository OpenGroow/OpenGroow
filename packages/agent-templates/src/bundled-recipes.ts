/**
 * Mission type `kind` and Bundled Recipes of a schemaVersion 2 Template
 * (ADR-091). Two pure halves, both without I/O so they run in Convex and in
 * the hub CI:
 * - `missionTypeContractProblem` checks the manifest declaration (kind, and
 *   the `recipes` list of a creative type);
 * - `readBundledRecipes` reads the declared files out of the package.
 */
import { parseDocument } from "yaml";
import type { BundledRecipe } from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const RECIPES_DIR = "recipes/";
const RECIPE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const RECIPE_FILE_KEYS = ["name", "description", "prompt", "instructions", "constraints"];

/** A `.yml` file inside the package's `recipes/` folder, with no way out of it. */
function isSafeRecipePath(path: unknown): path is string {
  if (typeof path !== "string" || !path.startsWith(RECIPES_DIR) || !path.endsWith(".yml")) return false;
  if (path.includes("\\") || path.includes("\0")) return false;
  return path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

/**
 * Why the Mission types of a manifest break the kind and recipes contract, or
 * `undefined`. From schemaVersion 2 every Mission type declares `kind` and a
 * creative one declares its Bundled Recipes; before it, neither key exists.
 */
export function missionTypeContractProblem(
  missionTypes: readonly Record<string, unknown>[],
  schemaVersion: number,
): string | undefined {
  for (const missionType of missionTypes) {
    const at = `missionTypes[${JSON.stringify(missionType.type)}]`;
    if (schemaVersion < 2) {
      const key = missionType.kind !== undefined ? "kind" : missionType.recipes !== undefined ? "recipes" : undefined;
      if (key) return `${at}.${key} needs schemaVersion 2: set "schemaVersion: 2" in the profile`;
      continue;
    }
    const { kind, recipes } = missionType;
    if (kind === undefined) return `${at}.kind is required from schemaVersion 2: declare "creative" or "operational"`;
    if (kind !== "creative" && kind !== "operational") {
      return `${at}.kind ${JSON.stringify(kind)} is not valid: declare "creative" or "operational"`;
    }
    if (kind === "operational") {
      if (recipes !== undefined) {
        return `${at} is operational: it cannot declare recipes, only a creative Mission type has Bundled Recipes`;
      }
      continue;
    }
    const problem = recipesProblem(recipes, at);
    if (problem) return problem;
  }
  return undefined;
}

function recipesProblem(recipes: unknown, at: string): string | undefined {
  if (!Array.isArray(recipes) || recipes.length === 0) {
    return `${at} is creative: declare recipes, a list of Bundled Recipes ({ id, path }) with exactly one \`default: true\``;
  }
  const seen = new Set<string>();
  let defaults = 0;
  for (const [index, recipe] of recipes.entries()) {
    if (!isRecord(recipe) || typeof recipe.id !== "string" || !RECIPE_ID.test(recipe.id)) {
      return `${at}.recipes[${index}].id must be a lowercase id (letters, digits, ".", "_" or "-", up to 64 characters)`;
    }
    const where = `${at}.recipes[${JSON.stringify(recipe.id)}]`;
    if (seen.has(recipe.id)) return `${at}.recipes has a duplicate recipe id ${JSON.stringify(recipe.id)}`;
    seen.add(recipe.id);
    if (!isSafeRecipePath(recipe.path)) {
      return `${where}.path must be a safe relative path to a .yml file inside the recipes/ folder (for example recipes/<mission type>/${recipe.id}.yml)`;
    }
    if (recipe.default !== undefined && typeof recipe.default !== "boolean") {
      return `${where}.default must be true or false`;
    }
    if (recipe.default === true) defaults += 1;
  }
  if (defaults !== 1) {
    return `${at}.recipes must declare exactly one \`default: true\` (the Default Recipe), found ${defaults}`;
  }
  return undefined;
}

type Read<T> = { ok: true; value: T } | { ok: false; reason: string };
const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

function readRecipeFile(path: string, source: string, at: string): Read<Omit<BundledRecipe, "missionType" | "id" | "default">> {
  const doc = parseDocument(source, { uniqueKeys: true });
  const error = doc.errors[0];
  if (error) return fail(`${at}: ${path} is not valid YAML: ${error.message}`);
  const data: unknown = doc.toJS();
  if (!isRecord(data)) return fail(`${at}: ${path} must be a mapping with name, description, instructions and constraints`);
  const unknown = Object.keys(data).find((key) => !RECIPE_FILE_KEYS.includes(key));
  if (unknown !== undefined) {
    return fail(`${at}: ${path} has an unknown key "${unknown}" — expected ${RECIPE_FILE_KEYS.join(", ")}`);
  }
  for (const key of ["name", "description", "instructions"]) {
    const value = data[key];
    if (typeof value !== "string" || value.trim().length === 0) return fail(`${at}: ${path} is missing "${key}" (a non-empty string)`);
  }
  if (data.prompt !== undefined && (typeof data.prompt !== "string" || data.prompt.trim().length === 0)) {
    return fail(`${at}: ${path} "prompt" must be a non-empty string when present`);
  }
  const { constraints } = data;
  if (!Array.isArray(constraints) || !constraints.every((c) => typeof c === "string" && c.trim().length > 0)) {
    return fail(`${at}: ${path} is missing "constraints" (a list of non-empty strings, possibly empty)`);
  }
  return {
    ok: true,
    value: {
      name: data.name as string,
      description: data.description as string,
      ...(typeof data.prompt === "string" ? { prompt: data.prompt } : {}),
      instructions: data.instructions as string,
      constraints: constraints as string[],
    },
  };
}

/**
 * Reads the recipe files the manifest declares, in manifest order. The
 * manifest is already validated: this only adds what needs the package.
 */
export function readBundledRecipes(
  missionTypes: ReadonlyArray<{ type: string; recipes?: ReadonlyArray<{ id: string; path: string; default?: boolean }> }>,
  files: Readonly<Record<string, string>>,
): Read<BundledRecipe[]> {
  const recipes: BundledRecipe[] = [];
  for (const missionType of missionTypes) {
    for (const declared of missionType.recipes ?? []) {
      const at = `missionTypes[${JSON.stringify(missionType.type)}].recipes[${JSON.stringify(declared.id)}]`;
      const source = files[declared.path];
      if (source === undefined) return fail(`${at}: the package has no ${declared.path}`);
      const file = readRecipeFile(declared.path, source, at);
      if (!file.ok) return file;
      recipes.push({ missionType: missionType.type, id: declared.id, default: declared.default === true, ...file.value });
    }
  }
  return { ok: true, value: recipes };
}
