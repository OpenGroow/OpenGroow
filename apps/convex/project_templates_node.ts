"use node";

import { action } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { v } from "convex/values";
import { clawPackageToTemplate } from "@opengroow/agent-templates";
import type { AgentManifest } from "@opengroow/agent-templates/types";
import { buildInstallationPlan, type InstallationPlan } from "@opengroow/agent-templates/installation-plan";
import { assetField, fetchGitPackage, type GitOrigin } from "@opengroow/agent-templates/git-archive";
import { fetchHubIndex, type HubEntry, type HubVerification } from "@opengroow/agent-templates/hub-index";
import { messageOf } from "./error_message.js";
import { env } from "./env.js";
import { requireAuthenticatedUser, requireInstanceOwner } from "./project_agents/auth.js";
import { assertLocalFolderInstallAllowed } from "./local_folder_gate.js";
import { packageFilesV, toClawFiles, validatePackage, type PackageFile } from "./template_registry_store.js";

/**
 * Add Agent from the hub (#668). The hub is a GitHub repository whose
 * `index.json` lists installable Templates (repository, tag, release archive
 * digest, category, trust level); its location is configured by
 * `OPENGROOW_HUB_REPOSITORY` / `OPENGROOW_HUB_REF`. Installing an entry downloads
 * the release and verifies it against the digest recorded in the index, never
 * one supplied by the caller: the client only names a Template id.
 */

export type HubCatalogueEntry = {
  templateId: string;
  name: string;
  description: string;
  category: string;
  tag: string;
  verification: HubVerification;
};

const toCatalogueEntry = (entry: HubEntry): HubCatalogueEntry => ({
  templateId: entry.id,
  name: entry.name,
  description: entry.description,
  category: entry.category,
  tag: entry.tag,
  verification: entry.verification,
});

const loadHubIndex = () =>
  fetchHubIndex({
    repository: env.OPENGROOW_HUB_REPOSITORY,
    ref: env.OPENGROOW_HUB_REF,
    fetch: (url) => fetch(url),
  });

/** The hub's Templates with their trust badge. A hub that cannot be read is reported, so the rest of the catalogue still shows. */
export const hubCatalogue = action({
  args: {},
  handler: async (ctx): Promise<{ entries: HubCatalogueEntry[]; error?: string }> => {
    await requireAuthenticatedUser(ctx);
    try {
      return { entries: (await loadHubIndex()).packages.map(toCatalogueEntry) };
    } catch (error) {
      return { entries: [], error: messageOf(error) };
    }
  },
});

type HubDownload = { files: PackageFile[]; gitOrigin: GitOrigin; manifest: AgentManifest };

/** Downloads the entry's release, verified against the index's digest, and checks it is the Template the entry names. */
async function downloadHubTemplate(templateId: string): Promise<HubDownload> {
  const entry = (await loadHubIndex()).packages.find((candidate) => candidate.id === templateId);
  if (!entry) throw new Error(`Template ${templateId} is not listed in the hub`);
  const { files, gitOrigin } = await fetchGitPackage({
    repository: entry.repository,
    tag: entry.tag,
    ...assetField(entry.asset),
    digest: entry.digest,
    fetch: (url) => fetch(url),
  });
  const converted = clawPackageToTemplate(toClawFiles(files));
  if (!converted.ok) throw new Error(converted.reason);
  const manifest = converted.template.manifest;
  if (manifest.id !== entry.id) {
    throw new Error(`The hub lists ${entry.id} but the package declares ${manifest.id}. Installation refused`);
  }
  return { files, gitOrigin, manifest };
}

type OwnedResult = { ok: true } | { ok: false; errorMessage: string };

async function requireOwner(ctx: Parameters<typeof requireAuthenticatedUser>[0], instanceId: string): Promise<OwnedResult> {
  const user = await requireAuthenticatedUser(ctx);
  return await requireInstanceOwner(ctx, instanceId, user);
}

/**
 * What adding a hub Template would do (its requirements and installation
 * plan), from a verified download, before anything is installed.
 */
export const previewHubTemplate = action({
  args: { instanceId: v.string(), templateId: v.string() },
  handler: async (
    ctx,
    { instanceId, templateId },
  ): Promise<{ status: "ok"; manifest: AgentManifest; plan: InstallationPlan } | { status: "error"; errorMessage: string }> => {
    const owner = await requireOwner(ctx, instanceId);
    if (!owner.ok) return { status: "error", errorMessage: owner.errorMessage };
    try {
      const { manifest } = await downloadHubTemplate(templateId);
      return { status: "ok", manifest, plan: buildInstallationPlan(manifest) };
    } catch (error) {
      return { status: "error", errorMessage: messageOf(error) };
    }
  },
});

/** Installs a hub Template into the Project's registry (origin `hub`) and reconciles the Instance. Activation is a separate step (`addProjectAgent`). */
export const installHubTemplate = action({
  args: { instanceId: v.string(), templateId: v.string() },
  handler: async (
    ctx,
    { instanceId, templateId },
  ): Promise<{ status: "installed"; templateId: string; version: string } | { status: "error"; errorMessage: string }> => {
    const owner = await requireOwner(ctx, instanceId);
    if (!owner.ok) return { status: "error", errorMessage: owner.errorMessage };
    try {
      const { files, gitOrigin } = await downloadHubTemplate(templateId);
      const installed = await ctx.runAction(internal.template_install_local.addFromHub, {
        projectId: instanceId,
        files,
        gitOrigin,
      });
      return { status: "installed", templateId: installed.templateId, version: installed.version };
    } catch (error) {
      return { status: "error", errorMessage: messageOf(error) };
    }
  },
});

/**
 * Add Agent from a local folder (#707), self-host only. The dashboard reads
 * the folder in the browser and sends its files (the server may not see the
 * owner's disk). The preview validates them as the install would and returns
 * the installation plan; nothing is stored.
 */
export const previewLocalFolder = action({
  args: { instanceId: v.string(), files: packageFilesV },
  handler: async (
    ctx,
    { instanceId, files },
  ): Promise<{ status: "ok"; manifest: AgentManifest; plan: InstallationPlan } | { status: "error"; errorMessage: string }> => {
    const owner = await requireOwner(ctx, instanceId);
    if (!owner.ok) return { status: "error", errorMessage: owner.errorMessage };
    try {
      assertLocalFolderInstallAllowed();
      const { manifest } = await validatePackage(files);
      return { status: "ok", manifest, plan: buildInstallationPlan(manifest) };
    } catch (error) {
      return { status: "error", errorMessage: messageOf(error) };
    }
  },
});

/** Installs the folder's package into the Project's registry (origin `local_folder`) and reconciles the Instance. Activation is a separate step (`addProjectAgent`). */
export const installLocalFolder = action({
  args: { instanceId: v.string(), files: packageFilesV },
  handler: async (
    ctx,
    { instanceId, files },
  ): Promise<{ status: "installed"; templateId: string; version: string } | { status: "error"; errorMessage: string }> => {
    const owner = await requireOwner(ctx, instanceId);
    if (!owner.ok) return { status: "error", errorMessage: owner.errorMessage };
    try {
      assertLocalFolderInstallAllowed();
      const installed = await ctx.runAction(internal.template_install_local.addFromFolder, { projectId: instanceId, files });
      return { status: "installed", templateId: installed.templateId, version: installed.version };
    } catch (error) {
      return { status: "error", errorMessage: messageOf(error) };
    }
  },
});
