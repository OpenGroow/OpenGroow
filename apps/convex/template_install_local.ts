import { v, type Infer } from "convex/values";
import type { Doc } from "./_generated/dataModel.js";
import { internalAction, internalMutation, type ActionCtx, type MutationCtx } from "./_generated/server.js";
import { assertLocalFolderInstallAllowed } from "./local_folder_gate.js";
import { internal } from "./_generated/api.js";
import type { ReconcileOutcome } from "./project_agents_node.js";
import { gitOriginV } from "./validators.js";
import { installTemplatePackage, offerTemplateUpdate, packageFilesV, type InstallResult, type PackageFile } from "./template_registry_store.js";

/**
 * Installation of a Template package without a user identity (#652): the entry
 * point of the self-host / development `template:add` script, run through
 * `npx convex run` with the deployment's admin key. The public
 * `project_templates.install` needs the Project owner's session, which a
 * script does not have; this internal wrapper reuses the same storage
 * (`installTemplatePackage`: strict validation, digest, snapshot) and is only
 * reachable with admin rights.
 */

async function installFrom(
  ctx: MutationCtx,
  projectId: string,
  files: PackageFile[],
  origin: Doc<"installedTemplates">["origin"],
  gitOrigin?: GitOrigin,
): Promise<InstallResult> {
  const instance = await ctx.db
    .query("instances")
    .withIndex("by_openclaw_id", (q) => q.eq("openclawId", projectId))
    .first();
  if (!instance) throw new Error(`Project not found: ${projectId}`);
  return await installTemplatePackage(ctx, { projectId, files, origin, gitOrigin });
}

export const install = internalMutation({
  args: { projectId: v.string(), files: packageFilesV },
  handler: async (ctx, { projectId, files }) => installFrom(ctx, projectId, files, "local_folder"),
});

/**
 * Git install (#667): the package was downloaded from a release archive whose
 * sha256 the caller (`template:add-git`) verified against the expected digest
 * before sending the files; the Git origin is recorded on the installed Template.
 */
export const installGit = internalMutation({
  args: { projectId: v.string(), files: packageFilesV, gitOrigin: gitOriginV },
  handler: async (ctx, { projectId, files, gitOrigin }) => installFrom(ctx, projectId, files, "git", gitOrigin),
});

/**
 * Hub install (#668): same as a Git install, but the release is the one a hub
 * index lists, downloaded and verified against the digest the index records
 * by `project_templates_node.installHubTemplate`, which is the only caller.
 */
export const installHub = internalMutation({
  args: { projectId: v.string(), files: packageFilesV, gitOrigin: gitOriginV },
  handler: async (ctx, { projectId, files, gitOrigin }) => installFrom(ctx, projectId, files, "hub", gitOrigin),
});

/** Link mode (#653): same install, but the snapshot of a version may be rewritten on each save. */
export const link = internalMutation({
  args: { projectId: v.string(), files: packageFilesV },
  handler: async (ctx, { projectId, files }) => installFrom(ctx, projectId, files, "linked_folder"),
});

type GitOrigin = Infer<typeof gitOriginV>;
type InstallAndReconcileResult = InstallResult & { reconciled: ReconcileOutcome[] };

/**
 * Installs the package into the Project, then reconciles the Instance from the
 * registry so the Template's active Agent receives the new files and skills.
 * Reconciliation failures are reported, not thrown: the install itself stands.
 */
async function installAndReconcile(
  ctx: ActionCtx,
  projectId: string,
  install: () => Promise<InstallResult>,
): Promise<InstallAndReconcileResult> {
  const installed = await install();
  const reconciled = await ctx.runAction(internal.project_agents_node.reconcileInstanceAgents, {
    instanceId: projectId,
    templateId: installed.templateId,
  });
  return { ...installed, reconciled };
}

export const addFromFolder = internalAction({
  args: { projectId: v.string(), files: packageFilesV },
  handler: (ctx, args): Promise<InstallAndReconcileResult> => {
    assertLocalFolderInstallAllowed();
    return installAndReconcile(ctx, args.projectId, () => ctx.runMutation(internal.template_install_local.install, args));
  },
});

export const addFromGit = internalAction({
  args: { projectId: v.string(), files: packageFilesV, gitOrigin: gitOriginV },
  handler: (ctx, args): Promise<InstallAndReconcileResult> => 
      installAndReconcile(ctx, args.projectId, () => ctx.runMutation(internal.template_install_local.installGit, args)),
});

export const addFromHub = internalAction({
  args: { projectId: v.string(), files: packageFilesV, gitOrigin: gitOriginV },
  handler: (ctx, args): Promise<InstallAndReconcileResult> =>
      installAndReconcile(ctx, args.projectId, () => ctx.runMutation(internal.template_install_local.installHub, args)),
});

/**
 * One save of a linked folder (#653): the Template's snapshot follows the
 * folder. An invalid package throws before anything is written, so the
 * previous valid snapshot stays in place and the caller can report the problem.
 */
export const linkFromFolder = internalAction({
  args: { projectId: v.string(), files: packageFilesV },
  handler: (ctx, args): Promise<InstallAndReconcileResult> => {
    assertLocalFolderInstallAllowed();
    return installAndReconcile(ctx, args.projectId, () => ctx.runMutation(internal.template_install_local.link, args));
  },
});

/**
 * Offers a newer version of an installed Template to the Project (#669),
 * without applying it: the Project is told, and confirms from the dashboard.
 * The entry point of whatever detects a newer version; the Git origin is
 * recorded when the package came from Git.
 */
export const offerUpdate = internalMutation({
  args: { projectId: v.string(), files: packageFilesV, gitOrigin: v.optional(gitOriginV) },
  handler: async (ctx, { projectId, files, gitOrigin }) => {
    const instance = await ctx.db
      .query("instances")
      .withIndex("by_openclaw_id", (q) => q.eq("openclawId", projectId))
      .first();
    if (!instance) throw new Error(`Project not found: ${projectId}`);
    return await offerTemplateUpdate(ctx, { projectId, files, origin: gitOrigin ? "git" : "local_folder", gitOrigin });
  },
});

/**
 * Hub update offer (#666, #669): same as `offerUpdate`, but the newer release
 * is the one a hub index lists, so the offer carries the hub origin and the
 * reserved `@opengroow` scope is accepted. Only the hub path may call it.
 */
export const offerHubUpdate = internalMutation({
  args: { projectId: v.string(), files: packageFilesV, gitOrigin: gitOriginV },
  handler: async (ctx, { projectId, files, gitOrigin }) => {
    const instance = await ctx.db
      .query("instances")
      .withIndex("by_openclaw_id", (q) => q.eq("openclawId", projectId))
      .first();
    if (!instance) throw new Error(`Project not found: ${projectId}`);
    return await offerTemplateUpdate(ctx, { projectId, files, origin: "hub", gitOrigin });
  },
});
