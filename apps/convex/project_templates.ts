import { internalQuery, mutation, query, type QueryCtx } from "./_generated/server.js";
import { v } from "convex/values";
import { isTemplateVisible, type ListTemplatesOptions } from "@opengroow/agent-templates";
import type { AgentManifest } from "@opengroow/agent-templates/types";
import type { TemplateRegistry } from "@opengroow/agent-templates/registry";
import { buildInstallationPlan } from "@opengroow/agent-templates/installation-plan";
import { env } from "./env.js";
import { canReadInstance } from "./project_agents.js";
import { assertLocalFolderInstallAllowed } from "./local_folder_gate.js";
import { getTemplateRegistry } from "./template_registry.js";
import { internal } from "./_generated/api.js";
import {
  applyStagedUpdate,
  findSnapshot,
  listUpdateOffers,
  installTemplatePackage,
  listCurrentInstalls,
  listCurrentSnapshots,
  listVersionUsage,
  packageFilesV,
} from "./template_registry_store.js";

/**
 * What the dashboard reads about a Project's Templates: manifests only (the
 * instruction files stay server-side). A Project id is an Instance's
 * `openclawId`. Registry-backed, so versioned/installed Templates (#642) reach
 * the dashboard without touching it.
 */

export async function listProjectManifests(
  registry: TemplateRegistry,
  projectId: string,
  options: ListTemplatesOptions,
): Promise<AgentManifest[]> {
  return (await registry.list(projectId, options)).map((template) => template.manifest);
}

export async function getProjectManifest(
  registry: TemplateRegistry,
  projectId: string,
  templateId: string,
  options: ListTemplatesOptions,
): Promise<AgentManifest | null> {
  const template = await registry.resolve(projectId, templateId);
  return template && isTemplateVisible(template.manifest, options) ? template.manifest : null;
}

/**
 * The registry key of a Project the caller may read. Dashboard URLs address a
 * Project by its `openclawId` or its `jobId`; the registry is keyed by the
 * former. `null` when the Project is unknown or not the caller's.
 */
export async function readableProjectId(ctx: QueryCtx, projectId: string): Promise<string | null> {
  if (await canReadInstance(ctx, projectId)) return projectId;
  const byJob = await ctx.db
    .query("instances")
    .withIndex("by_job_id", (q) => q.eq("jobId", projectId))
    .first();
  const openclawId = byJob?.openclawId;
  return openclawId && (await canReadInstance(ctx, openclawId)) ? openclawId : null;
}

function visibilityOptions(): ListTemplatesOptions {
  return { includeDevelopment: env.OPENGROOW_ENABLE_DEMO_AGENTS };
}

export const listForProject = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const readable = await readableProjectId(ctx, projectId);
    if (!readable) return [];
    return await listProjectManifests(getTemplateRegistry(ctx), readable, visibilityOptions());
  },
});

export const getForProject = query({
  args: { projectId: v.string(), templateId: v.string() },
  handler: async (ctx, { projectId, templateId }) => {
    const readable = await readableProjectId(ctx, projectId);
    if (!readable) return null;
    return await getProjectManifest(getTemplateRegistry(ctx), readable, templateId, visibilityOptions());
  },
});

/**
 * The Templates a Project can add an Agent of (#655): each with its version,
 * origin and installation plan, and whether the Project already has an Agent
 * of it (a Project holds at most one Agent per Template). Templates exist only
 * as installed packages (#674), so every entry has a version and an origin.
 * Each entry carries its manifest, so the dialog that
 * confirms the addition never depends on a second, possibly stale, query.
 */
export const catalogue = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const readable = await readableProjectId(ctx, projectId);
    if (!readable) return [];
    const manifests = await listProjectManifests(getTemplateRegistry(ctx), readable, visibilityOptions());
    const installs = new Map((await listCurrentInstalls(ctx, readable)).map((install) => [install.templateId, install]));
    const agents = await ctx.db
      .query("projectAgents")
      .withIndex("by_instance_template", (q) => q.eq("instanceId", readable))
      .collect();
    const added = new Set(agents.map((agent) => agent.templateId));
    return manifests.flatMap((manifest) => {
      const install = installs.get(manifest.id);
      if (!install) return [];
      return [
        {
          templateId: manifest.id,
          manifest,
          version: install.version,
          origin: install.origin,
          plan: buildInstallationPlan(manifest),
          added: added.has(manifest.id),
        },
      ];
    });
  },
});

/**
 * Installs a Template package into a Project's registry (#650). The package is
 * validated by the Claw adapter (strict manifest validation) and refused with
 * its message when invalid. Convex never runs package code: it only stores the
 * files and interprets the manifest as data.
 *
 * The origin is not a client input: only a local folder is installable today,
 * and a caller-chosen origin could claim `hub` (reserved to the official hub).
 */
export const install = mutation({
  args: { projectId: v.string(), files: packageFilesV },
  handler: async (ctx, { projectId, files }) => {
    // Self-host only (#707): nothing in the hosted product calls this (the
    // dashboard installs through the hub), and a folder has no digest to trust.
    assertLocalFolderInstallAllowed();
    if (!(await canReadInstance(ctx, projectId))) {
      throw new Error("Project not found or not accessible");
    }
    const identity = await ctx.auth.getUserIdentity();
    return await installTemplatePackage(ctx, {
      projectId,
      files,
      origin: "local_folder",
      installedBy: identity?.subject,
    });
  },
});

/** Where each current Template of the Project came from (a linked folder shows as `linked_folder`). */
export const origins = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const readable = await readableProjectId(ctx, projectId);
    if (!readable) return [];
    return await listCurrentInstalls(ctx, readable);
  },
});

/**
 * The stored versions of a Template in a Project and whether an unfinished
 * Mission still uses each (#651). `removable` marks a superseded version no
 * Mission needs any more; nothing is cleaned up automatically.
 */
export const versionUsage = query({
  args: { projectId: v.string(), templateId: v.string() },
  handler: async (ctx, { projectId, templateId }) => {
    const readable = await readableProjectId(ctx, projectId);
    if (!readable) return [];
    return await listVersionUsage(ctx, readable, templateId);
  },
});

/**
 * The newer versions offered to the Project, each with its update plan (#669):
 * changed MCP hosts, new secrets/plugins/skills, new required and re-activation
 * fields, removed Mission types a Schedule still uses. Reading never applies.
 */
export const updates = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const readable = await readableProjectId(ctx, projectId);
    if (!readable) return [];
    return await listUpdateOffers(ctx, readable);
  },
});

/**
 * Confirms an offered update (#669): the offered version becomes the Project's
 * current one and the Instance is reconciled to it. Missions already created
 * keep the version they were pinned to.
 */
export const applyUpdate = mutation({
  args: { projectId: v.string(), templateId: v.string(), version: v.string() },
  handler: async (ctx, { projectId, templateId, version }) => {
    if (!(await canReadInstance(ctx, projectId))) {
      throw new Error("Project not found or not accessible");
    }
    await applyStagedUpdate(ctx, projectId, templateId, version);
    await ctx.scheduler.runAfter(0, internal.project_agents_node.reconcileInstanceAgents, {
      instanceId: projectId,
      templateId,
    });
  },
});

/** Internal reads for the actions' registry (`getTemplateRegistry`): they have no database, only `runQuery`. */
export const resolveSnapshot = internalQuery({
  args: { projectId: v.string(), templateId: v.string(), version: v.optional(v.string()) },
  handler: async (ctx, { projectId, templateId, version }) => findSnapshot(ctx, projectId, templateId, version),
});

export const listSnapshots = internalQuery({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => listCurrentSnapshots(ctx, projectId),
});
