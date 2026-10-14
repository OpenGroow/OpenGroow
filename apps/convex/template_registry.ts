import type { ProjectId, TemplateRegistry } from "@opengroow/agent-templates/registry";
import { clawPackageToTemplate, isTemplateVisible, type AgentTemplate } from "@opengroow/agent-templates";
import { internal } from "./_generated/api.js";
import type { ActionCtx } from "./_generated/server.js";
import { env } from "./env.js";
import { applyMcpUrlOverrides, type McpUrlOverrides } from "./mcp_url_override.js";
import type { RunParent } from "./run_parent.js";
import {
  findCurrentVersion,
  findSnapshot,
  listCurrentSnapshots,
  listMcpUrlOverrides,
  toClawFiles,
  type RegistryDbCtx,
  type TemplateSnapshot,
} from "./template_registry_store.js";

let override: TemplateRegistry | undefined;

/** What registry reads need: a database (queries, mutations) or the ability to run a query (actions). */
export type RegistryCtx = RegistryDbCtx | Pick<ActionCtx, "runQuery">;

/** Reads the Project's installed Templates from wherever the caller can reach them. */
type SnapshotReader = {
  find(projectId: ProjectId, templateId: string, version?: string): Promise<TemplateSnapshot | null>;
  listCurrent(projectId: ProjectId): Promise<TemplateSnapshot[]>;
  mcpUrlOverrides(projectId: ProjectId, templateId: string): Promise<McpUrlOverrides>;
};

function snapshotReader(ctx: RegistryCtx): SnapshotReader {
  if ("db" in ctx) {
    return {
      find: (projectId, templateId, version) => findSnapshot(ctx, projectId, templateId, version),
      listCurrent: (projectId) => listCurrentSnapshots(ctx, projectId),
      mcpUrlOverrides: (projectId, templateId) => listMcpUrlOverrides(ctx, projectId, templateId),
    };
  }
  return {
    find: (projectId, templateId, version) =>
      ctx.runQuery(internal.project_templates.resolveSnapshot, { projectId, templateId, version }),
    listCurrent: (projectId) => ctx.runQuery(internal.project_templates.listSnapshots, { projectId }),
    mcpUrlOverrides: (projectId, templateId) =>
      ctx.runQuery(internal.template_mcp_overrides.forTemplate, { projectId, templateId }),
  };
}

/**
 * Applies the operator's MCP URL overrides (#654) to whatever the registry
 * resolves, so the runtime, Convex's own calls and the dashboard all see them.
 * The setting only exists on self-hosted deployments: hosted ones never read it.
 */
function withMcpUrlOverrides(registry: TemplateRegistry, reader: SnapshotReader): TemplateRegistry {
  const overridden = async (projectId: ProjectId, template: AgentTemplate) =>
    template.manifest.mcpServers.length === 0
      ? template
      : applyMcpUrlOverrides(template, await reader.mcpUrlOverrides(projectId, template.manifest.id));
  return {
    async resolve(projectId, templateId, version) {
      const template = await registry.resolve(projectId, templateId, version);
      return template && env.IS_SELF_HOST ? overridden(projectId, template) : template;
    },
    async list(projectId, options) {
      const templates = await registry.list(projectId, options);
      return env.IS_SELF_HOST ? Promise.all(templates.map((template) => overridden(projectId, template))) : templates;
    },
  };
}

/** Rebuilds the Template from its stored package files (the adapter already accepted them at install). */
function templateOf(snapshot: TemplateSnapshot): AgentTemplate {
  const converted = clawPackageToTemplate(toClawFiles(snapshot.files));
  if (!converted.ok) throw new Error(`Installed Template is unreadable: ${converted.reason}`);
  return converted.template;
}

/**
 * The Project's own registry: Templates exist only as installed packages
 * (#674). A Template the Project has not installed does not resolve.
 */
function projectRegistry(reader: SnapshotReader): TemplateRegistry {
  return {
    async resolve(projectId, templateId, version) {
      const snapshot = await reader.find(projectId, templateId, version);
      return snapshot ? templateOf(snapshot) : undefined;
    },
    async list(projectId, options) {
      const installed = (await reader.listCurrent(projectId)).map(templateOf);
      return installed.filter((template) => isTemplateVisible(template.manifest, options));
    },
  };
}

/**
 * The TemplateRegistry Convex functions resolve Templates through: the
 * Project's installed Templates, then the built-in ones. Tests swap in the
 * in-memory implementation with `setTemplateRegistryForTests`.
 *
 * Project id = Instance id: there is no Project table and Missions/Runs only
 * carry `instanceId`, so callers pass it as the registry's `projectId`.
 */
export function getTemplateRegistry(ctx: RegistryCtx): TemplateRegistry {
  const reader = snapshotReader(ctx);
  return withMcpUrlOverrides(override ?? projectRegistry(reader), reader);
}

/** Test seam: pass `undefined` to restore the Project-backed registry. */
export function setTemplateRegistryForTests(registry: TemplateRegistry | undefined): void {
  override = registry;
}

/**
 * The version a Mission created now is pinned to: the Project's current
 * installed version of the Template, or `undefined` (follow the current
 * version) when the Template is not installed.
 */
export async function currentTemplateVersion(
  ctx: RegistryDbCtx,
  projectId: ProjectId,
  templateId: string,
): Promise<string | undefined> {
  return findCurrentVersion(ctx, projectId, templateId);
}

/**
 * The version a Mission runs on: the one it was created with. Missions created
 * before pinning have no installed version to point at and follow the Project's
 * current one.
 */
export function missionTemplateVersion(mission: { templateVersion?: string }): string | undefined {
  return mission.templateVersion;
}

/**
 * The version a Run's Template resolves at: its Mission's pinned version; a
 * Job's Run has no Mission and follows the current version (`undefined`).
 */
export function runTemplateVersion(run: { parent: RunParent; templateVersion?: string }): string | undefined {
  return run.parent.kind === "mission" ? missionTemplateVersion(run) : undefined;
}

/** The Template a Mission runs on, at the version it was created with. */
export function resolveMissionTemplate(
  registry: TemplateRegistry,
  mission: { instanceId: string; templateId: string; templateVersion?: string },
) {
  return registry.resolve(mission.instanceId, mission.templateId, missionTemplateVersion(mission));
}
