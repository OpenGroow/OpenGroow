/** A Mission type id as a title: `create_reel` -> `Create Reel` (no snake case). */
export function titleCase(type: string, separator = "_"): string {
  return type
    .split(separator)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}
