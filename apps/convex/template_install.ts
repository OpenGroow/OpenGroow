import type { ProjectId } from "@opengroow/agent-templates/registry";
import type { MutationCtx } from "./_generated/server.js";
import type { Doc } from "./_generated/dataModel.js";
import { provisionCurrentTemplate } from "./bundled_recipes.js";
import {
  findCurrentVersion,
  promoteStagedVersion,
  storeInstalledPackage,
  type InstallResult,
  type PackageFile,
} from "./template_registry_store.js";

// Installing a Template and applying its update: the registry stores the version, then the Project's Bundled Recipes
// follow it (ADR-091). Kept apart from the store so the registry never depends on the recipes.

/** Stores the package (see `storeInstalledPackage`) and provisions its Bundled Recipes when it is the current version. */
export async function installTemplatePackage(
  ctx: MutationCtx,
  args: {
    projectId: ProjectId;
    files: readonly PackageFile[];
    origin: Doc<"installedTemplates">["origin"];
    gitOrigin?: Doc<"installedTemplates">["gitOrigin"];
    installedBy?: string;
  },
): Promise<InstallResult> {
  const installed = await storeInstalledPackage(ctx, args);
  // Every install path provisions the Bundled Recipes of the Template, a reinstall included (ADR-091); the call is
  // idempotent. Only a version that is the current one provisions: an older stored version is not what the Project runs.
  const current = await findCurrentVersion(ctx, args.projectId, installed.templateId);
  if (current === installed.version) await provisionCurrentTemplate(ctx, args.projectId, installed.templateId);
  return installed;
}

/** Makes the offered version current, then provisions its Bundled Recipes. */
export async function applyStagedUpdate(ctx: MutationCtx, projectId: ProjectId, templateId: string, version: string): Promise<void> {
  await promoteStagedVersion(ctx, projectId, templateId, version);
  // The new version's Bundled Recipes: added, updated, or turned into Custom Recipes when it no longer ships them.
  await provisionCurrentTemplate(ctx, projectId, templateId);
}
