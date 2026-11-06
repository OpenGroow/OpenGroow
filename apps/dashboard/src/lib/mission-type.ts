/** A Mission type id as a title: `create_reel` -> `Create Reel` (no snake case). */
export function titleCase(type: string): string {
  return type
    .split("_")
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}
