// Pure rule of a Production Recipe's target (issue #137): the Mission type it
// is written for must exist in an installed manifest and declare the provider.
// No Convex imports.

/** The provider a Mission type declares to say it can consume a recipe. */
export const RECIPE_PROVIDER = "production-recipe";

type ManifestLike = {
  missionTypes?: Array<{ type: string; kind?: "creative" | "operational"; contextProviders?: string[] }>;
};

/** True when the manifest has this Mission type and it declares the recipe provider. */
export function declaresRecipeProvider(manifest: ManifestLike, missionType: string): boolean {
  return manifest.missionTypes?.find((t) => t.type === missionType)?.contextProviders?.includes(RECIPE_PROVIDER) === true;
}

/**
 * A Mission type a recipe may be written for (the Recipe target, ADR-091): a creative one. The provider declaration
 * of a version 1 manifest still counts until the recipe-less path is removed.
 */
export function isRecipeTarget(manifest: ManifestLike, missionType: string): boolean {
  return manifest.missionTypes?.find((t) => t.type === missionType)?.kind === "creative" || declaresRecipeProvider(manifest, missionType);
}

/** Throws unless the Mission type exists and is creative (or declares the provider). */
export function validateRecipeTarget(manifest: ManifestLike, missionType: string): void {
  if (!manifest.missionTypes?.some((t) => t.type === missionType)) throw new Error(`Mission type "${missionType}" does not exist in this Template`);
  if (!isRecipeTarget(manifest, missionType)) {
    throw new Error(`Mission type "${missionType}" is not creative and declares no ${RECIPE_PROVIDER} provider: only a creative Mission type can have a Production Recipe`);
  }
}
