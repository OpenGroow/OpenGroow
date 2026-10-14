import { isTemplateVisible } from "./index.js";
import type { ListTemplatesOptions } from "./index.js";
import type { AgentTemplate } from "./types.js";

/**
 * A Project's id. There is no Project table: the `instances` document is the
 * Project record, so a Project id is an Instance id today. Named so a future
 * Project table is a one-place change.
 */
export type ProjectId = string;

/**
 * Asynchronous, Project-scoped source of Agent Templates. The only way to
 * resolve a Template (contract step of #642: the synchronous lookups are gone).
 */
export interface TemplateRegistry {
  /** Resolve a Template of a Project by id, optionally a specific version. */
  resolve(
    projectId: ProjectId,
    templateId: string,
    version?: string,
  ): Promise<AgentTemplate | undefined>;
  /** List a Project's Templates (latest version of each). */
  list(projectId: ProjectId, options?: ListTemplatesOptions): Promise<AgentTemplate[]>;
}

export type InMemoryTemplateEntry = {
  projectId: ProjectId;
  template: AgentTemplate;
  version?: string;
};

/**
 * Test double seeded with fixture Templates. "Latest" means the last seeded
 * entry for a Template id — versions are matched exactly, never compared. An
 * entry seeded without a version answers any requested version.
 */
export function createInMemoryTemplateRegistry(
  entries: readonly InMemoryTemplateEntry[] = [],
): TemplateRegistry {
  const forProject = (projectId: ProjectId) => entries.filter((e) => e.projectId === projectId);
  return {
    async resolve(projectId, templateId, version) {
      const matches = forProject(projectId).filter(
        (e) =>
          e.template.manifest.id === templateId &&
          (version === undefined || e.version === undefined || e.version === version),
      );
      return matches.at(-1)?.template;
    },
    async list(projectId, options) {
      const latest = new Map<string, AgentTemplate>();
      for (const e of forProject(projectId)) latest.set(e.template.manifest.id, e.template);
      return [...latest.values()].filter((t) => isTemplateVisible(t.manifest, options));
    },
  };
}
