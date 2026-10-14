import type { AgentTemplate, SourceDeclaration, SourceExternalJobPollingContract } from "@opengroow/agent-templates";
import { getTemplateRegistry, type RegistryCtx } from "./template_registry.js";

/** What a Template says about one Source id, or `null` when it does not
 * declare it. The guarantee (#529): an Agent can only write Sources its own
 * Template declared. */
export async function resolveSource(
  ctx: RegistryCtx,
  projectId: string,
  templateId: string,
  sourceId: string,
): Promise<{ declaration: SourceDeclaration; hasEnrichment: boolean } | null> {
  const template = await getTemplateRegistry(ctx).resolve(projectId, templateId);
  const declaration = template?.manifest.sources?.find((s) => s.type === sourceId);
  if (!declaration) return null;
  // An enrichment declared for this Source means the write is only the first
  // phase: the Source stays `processing` until the external job completes.
  return { declaration, hasEnrichment: templateHasEnrichment(template, sourceId) };
}

// What a Template declares for the enrichment phase of a Source (ADR-051,
// issues #529, #533): one place answers "does this Source have an enrichment,
// and what is its polling contract", for the write route (status of a first
// write), the SourceJob (which Sources still await a handoff) and the poller.

/** Whether an already-resolved Template declares an enrichment for the Source. */
export function templateHasEnrichment(template: AgentTemplate | undefined, sourceId: string): boolean {
  return isNonEmpty(declaredEnrichment(template, sourceId));
}

/** The job-type -> polling contract map an already-resolved Template declares for a Source, empty when none. */
export function declaredEnrichment(
  template: AgentTemplate | undefined,
  sourceId: string,
): Record<string, SourceExternalJobPollingContract> {
  return template?.manifest.externalJobsBySource?.[sourceId] ?? {};
}

function isNonEmpty(enrichment: Record<string, SourceExternalJobPollingContract>): boolean {
  return Object.keys(enrichment).length > 0;
}
