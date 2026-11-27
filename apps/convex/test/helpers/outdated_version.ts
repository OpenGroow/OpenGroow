import { clawPackageToTemplate } from "@opengroow/agent-templates";
import type { ProjectId } from "@opengroow/agent-templates/registry";
import type { MutationCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { computePackageDigest, toClawFiles, type PackageFile } from "../../template_registry_store";

/**
 * A Template version stored before ADR-091 (profile schemaVersion 1). An install refuses such a package now, so the
 * rows are written directly, as a deployment that already holds them has them. It becomes the current version.
 */
export async function storeOutdatedVersion(
  ctx: MutationCtx,
  args: { projectId: ProjectId; files: readonly PackageFile[]; origin?: Doc<"installedTemplates">["origin"] },
): Promise<{ templateId: string; version: string }> {
  const clawFiles = toClawFiles(args.files);
  const converted = clawPackageToTemplate(clawFiles);
  if (!converted.ok) throw new Error(converted.reason);
  const manifest = converted.template.manifest;
  const version = (JSON.parse(args.files.find((f) => f.path === "package.json")!.content) as { version: string }).version;
  const existing = await ctx.db
    .query("installedTemplates")
    .withIndex("by_project_template", (q) => q.eq("projectId", args.projectId).eq("templateId", manifest.id))
    .collect();
  for (const doc of existing) if (doc.current) await ctx.db.patch(doc._id, { current: false });
  const installedTemplateId = await ctx.db.insert("installedTemplates", {
    projectId: args.projectId,
    templateId: manifest.id,
    version,
    origin: args.origin ?? "local_folder",
    digest: await computePackageDigest(args.files),
    manifest,
    current: true,
    installedAt: Date.now(),
  });
  for (const file of args.files) await ctx.db.insert("templateFiles", { installedTemplateId, path: file.path, content: file.content });
  return { templateId: manifest.id, version };
}
