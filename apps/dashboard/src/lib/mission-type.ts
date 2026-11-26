/** A Mission type id as a title: `create_reel` -> `Create Reel` (no snake case). */
export function titleCase(type: string, separator = "_"): string {
  return type
    .split(separator)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

// The Agent id is `@scope/slug`; the slug reads as the Agent's name.
export function agentLabel(templateId: string): string {
  return titleCase(templateId.split("/").pop() ?? templateId, "-");
}
