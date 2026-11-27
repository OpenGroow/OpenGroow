// Pure rule of a Production Recipe's target (issue #137, ADR-091): the Mission type it
// is written for must exist in an installed manifest and be creative. No Convex imports.

type ManifestLike = {
  missionTypes?: Array<{ type: string; kind?: "creative" | "operational" }>;
};

/** A Mission type a recipe may be written for (the Recipe target, ADR-091): a creative one. */
export function isRecipeTarget(manifest: ManifestLike, missionType: string): boolean {
  return manifest.missionTypes?.find((t) => t.type === missionType)?.kind === "creative";
}

/** Throws unless the Mission type exists and is creative. */
export function validateRecipeTarget(manifest: ManifestLike, missionType: string): void {
  if (!manifest.missionTypes?.some((t) => t.type === missionType)) throw new Error(`Mission type "${missionType}" does not exist in this Template`);
  if (!isRecipeTarget(manifest, missionType)) {
    throw new Error(`Mission type "${missionType}" is not creative: only a creative Mission type can have a Production Recipe`);
  }
}
