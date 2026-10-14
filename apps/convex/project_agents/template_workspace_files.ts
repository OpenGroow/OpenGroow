import { validateManifest, type AgentTemplate } from "@opengroow/agent-templates";

type TemplateWorkspaceSource = Pick<AgentTemplate, "agentsMd" | "manifest" | "missionAgentsMd" | "sourceInstructions" | "jobInstructions">;

/**
 * Every file materialized in an Agent's workspace at Activation and refresh:
 * base AGENTS.md, each Mission type's instruction file (except the ones the
 * Agent hides, ADR-053) and each declared Source's instruction file. The manifest is re-validated first so a broken
 * declaration fails with the same message `validateManifest` gives.
 */
export function collectTemplateWorkspaceFiles(
  template: TemplateWorkspaceSource,
  options: { hiddenMissionTypes?: readonly string[] } = {},
): Map<string, string> {
  const hidden = new Set(options.hiddenMissionTypes ?? []);
  const validation = validateManifest(template.manifest);
  if (!validation.ok) {
    throw new Error(`Invalid Template manifest: ${validation.reason}`);
  }

  const files = new Map<string, string>([["AGENTS.md", template.agentsMd]]);
  const add = (path: string, content: string, owner: string) => {
    const existing = files.get(path);
    if (existing !== undefined && existing !== content) {
      throw new Error(`Template instruction path ${JSON.stringify(path)} (${owner}) resolves to conflicting contents`);
    }
    files.set(path, content);
  };

  for (const missionType of template.manifest.missionTypes ?? []) {
    if (!missionType.agentsMd || hidden.has(missionType.type)) continue;
    const content = template.missionAgentsMd?.[missionType.type];
    if (content === undefined) {
      throw new Error(
        `Template mission type ${JSON.stringify(missionType.type)} has no loaded instructions for ${JSON.stringify(missionType.agentsMd)}`,
      );
    }
    add(missionType.agentsMd, content, `mission type ${JSON.stringify(missionType.type)}`);
  }

  for (const source of template.manifest.sources ?? []) {
    const content = template.sourceInstructions?.[source.type];
    if (content === undefined) {
      throw new Error(
        `Template Source ${JSON.stringify(source.type)} has no loaded instructions for ${JSON.stringify(source.agentsMd)}`,
      );
    }
    add(source.agentsMd, content, `Source ${JSON.stringify(source.type)}`);
  }
  for (const jobType of template.manifest.jobTypes ?? []) {
    if (!jobType.agentsMd) continue;
    const content = template.jobInstructions?.[jobType.type];
    if (content === undefined) {
      throw new Error(
        `Template Job type ${JSON.stringify(jobType.type)} has no loaded instructions for ${JSON.stringify(jobType.agentsMd)}`,
      );
    }
    add(jobType.agentsMd, content, `Job type ${JSON.stringify(jobType.type)}`);
  }
  return files;
}

/**
 * Instruction file paths of the Mission types an Agent hides (ADR-053), for
 * removal from a workspace that already carries them. Only types the Template
 * declares are returned: a stale name in the hidden list is not turned into a path.
 */
export function hiddenMissionInstructionPaths(
  template: Pick<TemplateWorkspaceSource, "manifest">,
  hiddenMissionTypes: readonly string[] | undefined,
): string[] {
  const hidden = new Set(hiddenMissionTypes ?? []);
  return (template.manifest.missionTypes ?? [])
    .filter((missionType) => missionType.agentsMd && hidden.has(missionType.type))
    .map((missionType) => missionType.agentsMd);
}
