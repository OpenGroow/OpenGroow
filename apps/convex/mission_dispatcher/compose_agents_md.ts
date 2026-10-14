// OpenClaw injects a workspace AGENTS.md into the system prompt up to
// `bootstrapMaxChars` (20000) and silently cuts the rest. Stay under it with
// a margin for the truncation marker.
export const AGENTS_MD_INLINE_LIMIT = 18_000;

/**
 * AGENTS.md written at dispatch: the Template base plus the Mission type's
 * instructions. The instruction file is also materialized in the workspace
 * (see collectTemplateWorkspaceFiles), so when inlining it would push AGENTS.md
 * past the injection limit, point at the file instead of letting OpenClaw cut
 * the instructions mid-way.
 */
export function composeAgentsMd(
  base: string,
  missionInstructions: string | undefined,
  instructionsPath: string | undefined,
): string {
  if (!missionInstructions) return base;
  const inline = [base, "", "---", "", missionInstructions].join("\n");
  if (inline.length <= AGENTS_MD_INLINE_LIMIT || !instructionsPath) return inline;
  return [
    base,
    "",
    "---",
    "",
    `**Before doing anything else, read \`${instructionsPath}\` in this workspace in full (it is long, read every page). It holds the complete instructions for this Mission type and is not inlined here.**`,
  ].join("\n");
}
