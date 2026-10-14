import { ConvexError, v } from "convex/values";
import { clawPackageToTemplate, outboundUrlProblem, scopeReservationProblem, type ClawPackageFiles } from "@opengroow/agent-templates";
import type { ProjectId } from "@opengroow/agent-templates/registry";
import type { AgentManifest } from "@opengroow/agent-templates/types";
import { buildUpdatePlan, isNewerVersion, type UpdatePlan } from "@opengroow/agent-templates/update-plan";
import type { MutationCtx, QueryCtx } from "./_generated/server.js";
import type { Doc } from "./_generated/dataModel.js";
import type { McpUrlOverrides } from "./mcp_url_override.js";
import { env } from "./env.js";

/** The version legacy Missions were pinned to when Templates were compiled in (#674); never a real installed version. */

/**
 * Storage of the per-Project Template registry (#650, ADR-054). A Project is
 * identified by its Instance id. Reads are shared by queries/mutations (direct
 * `ctx.db`) and actions (through the internal queries below).
 */

export type PackageFile = { path: string; content: string };

/** A Template as stored: its version and the package files it is rebuilt from. */
export type TemplateSnapshot = { version: string; files: PackageFile[] };

export const packageFilesV = v.array(v.object({ path: v.string(), content: v.string() }));

/** What registry reads need: a database reader (queries and mutations alike). */
export type RegistryDbCtx = Pick<QueryCtx, "db">;

// A package's files are bounded by the package itself (validated at install).
async function fileDocsOf(ctx: RegistryDbCtx, installedTemplateId: Doc<"installedTemplates">["_id"]) {
  return await ctx.db
    .query("templateFiles")
    .withIndex("by_installed_template", (q) => q.eq("installedTemplateId", installedTemplateId))
    .collect();
}

async function snapshotOf(ctx: RegistryDbCtx, doc: Doc<"installedTemplates">): Promise<TemplateSnapshot> {
  const files = (await fileDocsOf(ctx, doc._id)).map(({ path, content }) => ({ path, content }));
  return { version: doc.version, files };
}

/** The Project's Template at an exact version, or its current one. */
export async function findSnapshot(
  ctx: RegistryDbCtx,
  projectId: ProjectId,
  templateId: string,
  version?: string,
): Promise<TemplateSnapshot | null> {
  const doc =
    version !== undefined
      ? await ctx.db
          .query("installedTemplates")
          .withIndex("by_project_template_version", (q) =>
            q.eq("projectId", projectId).eq("templateId", templateId).eq("version", version),
          )
          .unique()
      : await ctx.db
          .query("installedTemplates")
          .withIndex("by_project_current_template", (q) =>
            q.eq("projectId", projectId).eq("current", true).eq("templateId", templateId),
          )
          .unique();
  return doc ? await snapshotOf(ctx, doc) : null;
}

/** The Project's current installed version of a Template, without loading its files. */
export async function findCurrentVersion(
  ctx: RegistryDbCtx,
  projectId: ProjectId,
  templateId: string,
): Promise<string | undefined> {
  const doc = await ctx.db
    .query("installedTemplates")
    .withIndex("by_project_current_template", (q) =>
      q.eq("projectId", projectId).eq("current", true).eq("templateId", templateId),
    )
    .unique();
  return doc?.version;
}

/** The current version of each Template installed in the Project. */
export async function listCurrentSnapshots(ctx: RegistryDbCtx, projectId: ProjectId): Promise<TemplateSnapshot[]> {
  // One current row per installed Template: bounded by the Project's installs.
  const docs = await ctx.db
    .query("installedTemplates")
    .withIndex("by_project_current_template", (q) => q.eq("projectId", projectId).eq("current", true))
    .collect();
  return await Promise.all(docs.map((d) => snapshotOf(ctx, d)));
}

/** Version and origin of each Template installed in the Project (current version), without loading files. */
export async function listCurrentInstalls(
  ctx: RegistryDbCtx,
  projectId: string,
): Promise<Pick<Doc<"installedTemplates">, "templateId" | "version" | "origin" | "gitOrigin">[]> {
  const docs = await ctx.db
    .query("installedTemplates")
    .withIndex("by_project_current_template", (q) => q.eq("projectId", projectId).eq("current", true))
    .collect();
  return docs.map((d) => ({
    templateId: d.templateId,
    version: d.version,
    origin: d.origin,
    ...(d.gitOrigin ? { gitOrigin: d.gitOrigin } : {}),
  }));
}

/** The operator's MCP URL overrides of a Project's Template, by server name (#654). */
export async function listMcpUrlOverrides(
  ctx: RegistryDbCtx,
  projectId: ProjectId,
  templateId: string,
): Promise<McpUrlOverrides> {
  // At most one per MCP server the Template declares.
  const docs = await ctx.db
    .query("templateMcpUrlOverrides")
    .withIndex("by_project_template", (q) => q.eq("projectId", projectId).eq("templateId", templateId))
    .collect();
  return Object.fromEntries(docs.map((doc) => [doc.serverName, doc.url]));
}

/** `sha256:<hex>` over the package's files, independent of their order. */
export async function computePackageDigest(files: readonly PackageFile[]): Promise<string> {
  const canonical = JSON.stringify(
    [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((f) => [f.path, f.content]),
  );
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

export function toClawFiles(files: readonly PackageFile[]): ClawPackageFiles {
  return Object.fromEntries(files.map((f) => [f.path, f.content]));
}

function readPackageVersion(files: ClawPackageFiles): string {
  const raw = files["package.json"];
  if (raw === undefined) throw new ConvexError("package.json is missing");
  let version: unknown;
  try {
    version = (JSON.parse(raw) as { version?: unknown }).version;
  } catch {
    throw new ConvexError("package.json is not valid JSON");
  }
  if (typeof version !== "string" || version.length === 0) {
    throw new ConvexError('package.json is missing "version" (a non-empty string)');
  }
  return version;
}

type ValidatedPackage = { version: string; manifest: AgentManifest; templateId: string; digest: string };

export async function validatePackage(files: readonly PackageFile[]): Promise<ValidatedPackage> {
  const paths = new Set(files.map((f) => f.path));
  if (paths.size !== files.length) throw new ConvexError("Package contains duplicate file paths");

  const clawFiles = toClawFiles(files);
  const converted = clawPackageToTemplate(clawFiles);
  if (!converted.ok) throw new ConvexError(converted.reason);
  const manifest: AgentManifest = converted.template.manifest;
  return { version: readPackageVersion(clawFiles), manifest, templateId: manifest.id, digest: await computePackageDigest(files) };
}

export type InstallResult = { templateId: string; version: string; digest: string };

/**
 * Validates a package through the Claw adapter (strict manifest validation),
 * then stores its snapshot in the Project's registry: a new version becomes
 * the current one; reinstalling an existing version is a no-op when the
 * digest matches and refused otherwise (versions are immutable, #651), except
 * that a linked folder's same-version snapshot is replaced (#653). Nothing is
 * written when the package is refused (the adapter's reason is the message).
 */
/**
 * Hosted deployment only (#670): the shared backend calls the MCP URLs a
 * package declares, so none may target a private, loopback or reserved address.
 * A self-hosted deployment's operator owns the network and is not restricted.
 */
function assertMcpUrlsAllowed(manifest: AgentManifest): void {
  if (env.IS_SELF_HOST) return;
  for (const server of manifest.mcpServers) {
    const urls = { url: server.url, activationUrl: server.activationUrl, publicBaseUrl: server.publicBaseUrl };
    for (const [field, value] of Object.entries(urls)) {
      if (value === undefined) continue;
      const problem = outboundUrlProblem(value);
      if (problem) throw new ConvexError(`MCP server "${server.name}" ${field}: ${problem}`);
    }
  }
}

/**
 * The `@opengroow` scope and system content are reserved to the official hub
 * (#666); see `scopeReservationProblem`. Hosted deployment only: the rule
 * protects the shared backend from impersonation, and a self-hosted operator
 * owns what their own deployment installs (e.g. developing an official
 * Template from its folder).
 */
function assertScopeReservation(manifest: AgentManifest, origin: Doc<"installedTemplates">["origin"]): void {
  if (env.IS_SELF_HOST) return;
  const problem = scopeReservationProblem(manifest, origin);
  if (problem) throw new ConvexError(problem);
}

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
  const { version, manifest, templateId, digest } = await validatePackage(args.files);

  assertMcpUrlsAllowed(manifest);
  assertScopeReservation(manifest, args.origin);
  // A direct install supersedes any offered update of the Template (#669).
  await deleteStaged(ctx, args.projectId, templateId);

  const existing = await ctx.db
    .query("installedTemplates")
    .withIndex("by_project_template", (q) => q.eq("projectId", args.projectId).eq("templateId", templateId))
    .collect();
  const sameVersion = existing.find((doc) => doc.version === version);
  if (sameVersion) {
    const linked = args.origin === "linked_folder" && sameVersion.origin === "linked_folder";
    const identical = sameVersion.digest === digest;
    // A version is immutable: Missions are pinned to it. The one exception is a
    // linked folder (#653), whose snapshot follows the files being edited: only
    // a linked install may rewrite it, and only a linked version is rewritable.
    if (!identical && !linked) {
      throw new ConvexError(
        `Template "${templateId}" version ${version} is already installed with different content: change the version to install this package`,
      );
    }
    if (!linked) return { templateId, version, digest };
    // The linked folder is what the Project follows, so its version becomes the
    // current one even when its content is unchanged (a return to an earlier edit).
    await demoteCurrentExcept(ctx, existing, sameVersion._id);
    if (identical) {
      if (!sameVersion.current) await ctx.db.patch(sameVersion._id, { current: true });
      return { templateId, version, digest };
    }
    for (;;) {
      const stale = await ctx.db
        .query("templateFiles")
        .withIndex("by_installed_template", (q) => q.eq("installedTemplateId", sameVersion._id))
        .take(100);
      if (stale.length === 0) break;
      for (const file of stale) await ctx.db.delete(file._id);
    }
    await ctx.db.patch(sameVersion._id, { digest, manifest, current: true, installedAt: Date.now() });
    await insertFiles(ctx, sameVersion._id, args.files);
    return { templateId, version, digest };
  }
  await demoteCurrentExcept(ctx, existing);

  const installedTemplateId = await ctx.db.insert("installedTemplates", {
    projectId: args.projectId,
    templateId,
    version,
    origin: args.origin,
    ...(args.gitOrigin !== undefined ? { gitOrigin: args.gitOrigin } : {}),
    digest,
    manifest,
    current: true,
    installedAt: Date.now(),
    ...(args.installedBy !== undefined ? { installedBy: args.installedBy } : {}),
  });
  await insertFiles(ctx, installedTemplateId, args.files);
  return { templateId, version, digest };
}

async function demoteCurrentExcept(
  ctx: MutationCtx,
  docs: readonly Doc<"installedTemplates">[],
  keep?: Doc<"installedTemplates">["_id"],
): Promise<void> {
  for (const doc of docs) {
    if (doc.current && doc._id !== keep) await ctx.db.patch(doc._id, { current: false });
  }
}

async function insertFiles(
  ctx: MutationCtx,
  installedTemplateId: Doc<"installedTemplates">["_id"],
  files: readonly PackageFile[],
): Promise<void> {
  for (const file of files) {
    await ctx.db.insert("templateFiles", { installedTemplateId, path: file.path, content: file.content });
  }
}

/**
 * Missions that may still be reviewed, retried or polled, so still need the
 * Template version they were created with (done and cancelled ones do not).
 */
const UNFINISHED_MISSION_STATUSES = [
  "todo",
  "doing",
  "blocked",
  "to_validate",
  "approved",
  "failed",
] as const satisfies readonly Doc<"missions">["status"][];

/**
 * Whether an unfinished Mission of the Project still references this Template version.
 * Only matches Missions that stored `templateVersion` explicitly: a Mission created
 * before version pinning has the field absent and is not found by the index.
 * That is safe for `listVersionUsage`, which only asks about installed versions.
 */
export async function isVersionInUse(
  ctx: RegistryDbCtx,
  projectId: ProjectId,
  templateId: string,
  version: string,
): Promise<boolean> {
  // One indexed `.first()` per unfinished status: finished Missions are never read.
  for (const status of UNFINISHED_MISSION_STATUSES) {
    const mission = await ctx.db
      .query("missions")
      .withIndex("by_instance_template_version_status", (q) =>
        q.eq("instanceId", projectId).eq("templateId", templateId).eq("templateVersion", version).eq("status", status),
      )
      .first();
    if (mission) return true;
  }
  return false;
}

export type TemplateVersionUsage = { version: string; current: boolean; inUse: boolean; removable: boolean };

/**
 * Every stored version of a Template with whether an unfinished Mission still
 * uses it. A version is removable once it is superseded and unused; nothing is
 * removed automatically.
 */
export async function listVersionUsage(
  ctx: RegistryDbCtx,
  projectId: ProjectId,
  templateId: string,
): Promise<TemplateVersionUsage[]> {
  const docs = await ctx.db
    .query("installedTemplates")
    .withIndex("by_project_template", (q) => q.eq("projectId", projectId).eq("templateId", templateId))
    .collect();
  return await Promise.all(
    docs.filter((doc) => doc.staged !== true).map(async (doc) => {
      const inUse = await isVersionInUse(ctx, projectId, templateId, doc.version);
      return { version: doc.version, current: doc.current, inUse, removable: !doc.current && !inUse };
    }),
  );
}

async function deleteFilesOf(ctx: MutationCtx, installedTemplateId: Doc<"installedTemplates">["_id"]): Promise<void> {
  for (;;) {
    const batch = await ctx.db
      .query("templateFiles")
      .withIndex("by_installed_template", (q) => q.eq("installedTemplateId", installedTemplateId))
      .take(100);
    if (batch.length === 0) return;
    for (const file of batch) await ctx.db.delete(file._id);
  }
}

async function stagedDocs(ctx: RegistryDbCtx, projectId: ProjectId, templateId: string) {
  // The offered updates of one Template: at most one by construction.
  return await ctx.db
    .query("installedTemplates")
    .withIndex("by_project_template_staged", (q) => q.eq("projectId", projectId).eq("templateId", templateId).eq("staged", true))
    .take(10);
}

async function deleteStaged(ctx: MutationCtx, projectId: ProjectId, templateId: string): Promise<void> {
  for (const doc of await stagedDocs(ctx, projectId, templateId)) {
    await deleteFilesOf(ctx, doc._id);
    await ctx.db.delete(doc._id);
  }
}

/**
 * Offers a newer version of an installed Template to the Project (#669). The
 * package is validated like an install and stored beside the current version,
 * but nothing resolves it: the Project keeps running its current version, and
 * Missions keep pinning it, until the user confirms with `applyStagedUpdate`.
 * A later offer replaces the previous one.
 */
export async function offerTemplateUpdate(
  ctx: MutationCtx,
  args: {
    projectId: ProjectId;
    files: readonly PackageFile[];
    origin: Doc<"installedTemplates">["origin"];
    gitOrigin?: Doc<"installedTemplates">["gitOrigin"];
  },
): Promise<InstallResult> {
  const { version, manifest, templateId, digest } = await validatePackage(args.files);
  assertMcpUrlsAllowed(manifest);
  assertScopeReservation(manifest, args.origin);
  const current = await ctx.db
    .query("installedTemplates")
    .withIndex("by_project_current_template", (q) =>
      q.eq("projectId", args.projectId).eq("current", true).eq("templateId", templateId),
    )
    .unique();
  if (!current) throw new ConvexError(`Template "${templateId}" is not installed in this Project: install it instead`);
  if (!isNewerVersion(version, current.version)) {
    throw new ConvexError(`Version ${version} is not newer than the installed ${current.version}`);
  }
  const stored = await ctx.db
    .query("installedTemplates")
    .withIndex("by_project_template_version", (q) =>
      q.eq("projectId", args.projectId).eq("templateId", templateId).eq("version", version),
    )
    .unique();
  if (stored && stored.staged !== true) {
    throw new ConvexError(`Version ${version} of "${templateId}" is already stored in this Project`);
  }
  await deleteStaged(ctx, args.projectId, templateId);
  const installedTemplateId = await ctx.db.insert("installedTemplates", {
    projectId: args.projectId,
    templateId,
    version,
    origin: args.origin,
    ...(args.gitOrigin !== undefined ? { gitOrigin: args.gitOrigin } : {}),
    digest,
    manifest,
    current: false,
    staged: true,
    installedAt: Date.now(),
  });
  await insertFiles(ctx, installedTemplateId, args.files);
  return { templateId, version, digest };
}

/** Makes the offered version the Project's current one. Missions already created keep their pinned version. */
export async function applyStagedUpdate(
  ctx: MutationCtx,
  projectId: ProjectId,
  templateId: string,
  version: string,
): Promise<void> {
  const staged = (await stagedDocs(ctx, projectId, templateId)).find((doc) => doc.version === version);
  if (!staged) throw new ConvexError(`Version ${version} of "${templateId}" is not offered as an update`);
  // At most one current version per (project, template).
  const currents = await ctx.db
    .query("installedTemplates")
    .withIndex("by_project_current_template", (q) => q.eq("projectId", projectId).eq("current", true).eq("templateId", templateId))
    .take(10);
  await demoteCurrentExcept(ctx, currents, staged._id);
  await ctx.db.patch(staged._id, { current: true, staged: false, installedAt: Date.now() });
}

export type TemplateUpdateOffer = {
  templateId: string;
  currentVersion: string;
  availableVersion: string;
  origin: Doc<"installedTemplates">["origin"];
  plan: UpdatePlan;
};

async function pluginIdsOf(ctx: RegistryDbCtx, doc: Doc<"installedTemplates">): Promise<string[]> {
  const converted = clawPackageToTemplate(toClawFiles(await fileDocsOf(ctx, doc._id)));
  return converted.ok ? (converted.template.plugins ?? []).map((plugin) => plugin.id) : [];
}

/** The updates offered to the Project, each with its plan against the current version. */
export async function listUpdateOffers(ctx: RegistryDbCtx, projectId: ProjectId): Promise<TemplateUpdateOffer[]> {
  // One staged row at most per installed Template: bounded by the Project's installs.
  const stagedRows = await ctx.db
    .query("installedTemplates")
    .withIndex("by_project_staged", (q) => q.eq("projectId", projectId).eq("staged", true))
    .take(200);
  const offers: TemplateUpdateOffer[] = [];
  for (const staged of stagedRows) {
    const current = await ctx.db
      .query("installedTemplates")
      .withIndex("by_project_current_template", (q) =>
        q.eq("projectId", projectId).eq("current", true).eq("templateId", staged.templateId),
      )
      .unique();
    if (!current) continue;
    const schedules = await ctx.db
      .query("schedules")
      .withIndex("by_instance_template", (q) => q.eq("instanceId", projectId).eq("templateId", staged.templateId))
      .collect();
    const plan = buildUpdatePlan(
      { version: current.version, manifest: current.manifest as AgentManifest, pluginIds: await pluginIdsOf(ctx, current) },
      { version: staged.version, manifest: staged.manifest as AgentManifest, pluginIds: await pluginIdsOf(ctx, staged) },
      schedules.map((schedule) => schedule.type),
    );
    offers.push({
      templateId: staged.templateId,
      currentVersion: current.version,
      availableVersion: staged.version,
      origin: staged.origin,
      plan,
    });
  }
  return offers;
}
