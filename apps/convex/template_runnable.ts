import { isTemplateVersionRunnable } from "@opengroow/agent-templates/schema-version";
import type { ProjectId } from "@opengroow/agent-templates/registry";
import { getTemplateRegistry, type RegistryCtx } from "./template_registry.js";

// A Template version below profile schemaVersion 2 is outdated (ADR-091): readable for history, never the start of a
// new Run. Every point that inserts a Run asks this one question, derived from the stored manifest, never stored.

/** The message of a refusal, shown to the user as is. */
export function outdatedTemplateMessage(templateId: string): string {
  return `Template ${templateId} is outdated: update it to start anything new from it. Existing content stays readable and can still be approved and published.`;
}

/**
 * Why a new Run cannot start from this Template (`version` pins one; absent follows the Project's current version),
 * or null when it can. A Template that is not installed is not "outdated": the callers' own checks refuse it.
 */
export async function newRunBlock(ctx: RegistryCtx, projectId: ProjectId, templateId: string, version?: string): Promise<string | null> {
  const template = await getTemplateRegistry(ctx).resolve(projectId, templateId, version);
  if (!template || isTemplateVersionRunnable(template.manifest)) return null;
  return outdatedTemplateMessage(templateId);
}

/** Refuses with the outdated message, before anything is written. */
export async function assertNewRunAllowed(ctx: RegistryCtx, projectId: ProjectId, templateId: string, version?: string): Promise<void> {
  const block = await newRunBlock(ctx, projectId, templateId, version);
  if (block) throw new Error(block);
}
