// Pure rule of a Production Recipe's target (issue #137): the Mission type it
// is written for must exist in an installed manifest and declare the provider.
// No Convex imports.

/** The provider a Mission type declares to say it can consume a recipe. */
export const RECIPE_PROVIDER = "production-recipe";

type ManifestLike = {
  missionTypes?: Array<{ type: string; contextProviders?: string[] }>;
};

/** Throws unless the Mission type exists and declares the provider. */
export function validateRecipeTarget(manifest: ManifestLike, missionType: string): void {
  const type = manifest.missionTypes?.find((t) => t.type === missionType);
  if (!type) throw new Error(`Mission type "${missionType}" does not exist in this Template`);
  if (!type.contextProviders?.includes(RECIPE_PROVIDER)) {
    throw new Error(`Mission type "${missionType}" does not declare the ${RECIPE_PROVIDER} provider`);
  }
}
