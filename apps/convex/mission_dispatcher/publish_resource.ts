import {
  isMcpOwnedKind,
  RESOURCE_PUBLISHABLE_FIELDS,
  OPTIONAL_PUBLISHABLE_FIELDS,
  readMediaPath,
  type PublishDeclaration,
  type PublishResource,
} from "@opengroow/agent-templates";
import { publishableDraftSchema, publishableSchema, type Publishable } from "../publishable.js";
import { validatePublishableKind } from "./reconciliation.js";

/** `publishable.<path>: <message>` for each zod issue, so a failure names its field. */
function formatIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues.map((issue) => `publishable.${issue.path.map(String).join(".")}: ${issue.message}`).join("; ");
}

/**
 * The arguments of the one call OpenGroow makes to `publish.resource.tool`
 * when an External Job completes (issue #26, ADR-069).
 */
export function publishResourceCall(resource: PublishResource, jobId: string): {
  tool: string;
  args: Record<string, unknown>;
} {
  return { tool: resource.tool, args: { [resource.idArg ?? "runId"]: jobId } };
}

export type MergedPublishable = { ok: true; publishable: Publishable } | { ok: false; message: string };

/**
 * Merges the media an MCP tool returned into the text part the Agent wrote,
 * then validates the whole Publishable against the Mission type's `publish`.
 * Pure. The Agent's fields always win: the tool only contributes the media
 * fields of the kind (read from the recommended names or `resource.map`).
 * Nothing partial comes out: a missing or invalid media is one precise message
 * per field. For a kind the MCP owns (`article`, ADR-074) there is no text
 * part: the tool returns every field, and a draft is refused.
 */
export function mergePublishResource(input: {
  missionType: string;
  declaration: PublishDeclaration & { resource: PublishResource };
  draft: unknown;
  toolOutput: unknown;
}): MergedPublishable {
  const { declaration, missionType } = input;
  const { resource } = declaration;
  const ownedByMcp = isMcpOwnedKind(declaration.kind);
  let text: Record<string, unknown>;
  if (ownedByMcp) {
    // Reconciliation already refuses it; checked again so this merge never takes an Agent's field.
    if (input.draft !== undefined) {
      return { ok: false, message: `the Agent wrote a publishable, but the MCP owns the whole ${declaration.kind}` };
    }
    text = { kind: declaration.kind };
  } else {
    const draft = publishableDraftSchema.safeParse(input.draft);
    if (!draft.success) {
      return { ok: false, message: `the in_progress publishable is not a valid text part: ${formatIssues(draft.error.issues)}` };
    }
    text = draft.data;
  }

  const media: Record<string, unknown> = {};
  const problems: string[] = [];
  // A media is required unless the kind lists it among its optional fields
  // (`coverUrl`, `variants`). An image or carousel needs its default media or
  // variants: one of the two, checked once below.
  // `metadata` is free and never required.
  const optional: readonly string[] = [...OPTIONAL_PUBLISHABLE_FIELDS[declaration.kind], "metadata"];
  const alternative = declaration.kind === "image" || declaration.kind === "carousel";
  for (const field of RESOURCE_PUBLISHABLE_FIELDS[declaration.kind]) {
    const path = resource.map?.[field] ?? field;
    const value = readMediaPath(input.toolOutput, path);
    if (value !== undefined && value !== null) media[field] = value;
    else if (!optional.includes(field) && !alternative) {
      problems.push(`publishable.${field} is missing: tool "${resource.tool}" returned nothing at "${path}"`);
    }
  }
  if (alternative && Object.keys(media).length === 0) {
    const [first, second] = RESOURCE_PUBLISHABLE_FIELDS[declaration.kind];
    const where = (field: string) => `"${resource.map?.[field as "variants"] ?? field}"`;
    problems.push(`publishable.${first} is missing: tool "${resource.tool}" returned nothing at ${where(first)} nor at ${where(second)}`);
  }
  if (problems.length > 0) return { ok: false, message: problems.join("; ") };

  const merged = publishableSchema.safeParse({ ...media, ...text });
  if (!merged.success) return { ok: false, message: formatIssues(merged.error.issues) };
  const kindError = validatePublishableKind(merged.data, { missionType, publish: declaration });
  return kindError ? { ok: false, message: kindError } : { ok: true, publishable: merged.data };
}
