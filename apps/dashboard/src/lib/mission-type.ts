/** A Mission type id as a title: `create_reel` -> `Create Reel` (no snake case). */
export function titleCase(type: string, separator = "_"): string {
  return type
    .split(separator)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

/** The label a Template gives a Mission type, wherever the Project's Templates declare it; the type as a title otherwise. */
export function missionTypeLabel(
  manifests: ReadonlyArray<{ missionTypes?: ReadonlyArray<{ type: string; label: string }> }>,
  type: string,
): string {
  for (const manifest of manifests) {
    const entry = manifest.missionTypes?.find((candidate) => candidate.type === type);
    if (entry) return entry.label;
  }
  return titleCase(type);
}
