import { v } from "convex/values";
import { zodToConvex } from "convex-helpers/server/zod4";
import { z } from "zod";
import type { SourceDeclaration } from "@opengroow/agent-templates";

// The common layers of a Source (issue #529, ADR-051), defined once here and
// derived three ways — "one zod definition, three derivations": the route
// validator (`validateSourceWrite`), the JSON Schema handed to the Agent
// (`buildSourceJsonSchema`, via `z.toJSONSchema`) and the Convex table/insert
// validator (`sourceMarketingV`, via `zodToConvex`). Nothing restates the
// fields, so `schema.ts` and `sources.ts` cannot drift from the route.
//
// Everything is `strict`: a caller cannot smuggle in fields it does not own
// (`label`, `family`, `status`, scoring…) — unknown keys are validation errors.

const MAX_ITEMS = 10;
const MAX_ITEM_LENGTH = 200;
const MAX_TEXT_LENGTH = 500;

const MAX_RAW_LENGTH = 64 * 1024;

// Marketing values are free text and bounded. Only the six list fields are
// normalized (trimmed, case-folded) so they compare across Sources; the prose
// fields (`summary`, `problem`, `intent`) are trimmed and bounded, case kept.
const marketingItem = z.string().trim().toLowerCase().min(1).max(MAX_ITEM_LENGTH);
const marketingList = z.array(marketingItem).max(MAX_ITEMS);
const marketingText = z.string().trim().min(1).max(MAX_TEXT_LENGTH);

// Layer 2 of a Source (ADR-051): the common marketing representation — what
// the Source teaches, in terms that compare across origins. All optional, all
// free text: what is enforced is the fields and their types, not the wording.
export const marketingSchema = z.strictObject({
  summary: marketingText.optional(),
  topics: marketingList.optional(),
  audiences: marketingList.optional(),
  problem: marketingText.optional(),
  intent: marketingText.optional(),
  emotions: marketingList.optional(),
  contentPatterns: marketingList.optional(),
  reproducibleElements: marketingList.optional(),
  topicSpecificElements: marketingList.optional(),
});

export const commonSchema = z.strictObject({
  // Where the Source was seen: a URL, a provider name…
  origin: z.string().trim().min(1).max(2000),
  // When the Agent observed it (epoch ms).
  capturedAt: z.number().int().positive(),
  marketing: marketingSchema,
  // Optional verbatim capture of what the Agent saw (transcript, page text...),
  // kept as-is on the Source; capped at 64 KB.
  raw: z.string().max(MAX_RAW_LENGTH).optional(),
});

export type SourceCommon = z.output<typeof commonSchema>;

/** The Convex validator for the marketing layer, derived from `marketingSchema`
 * so the table (`schema.ts`), the insert mutation (`sources.ts`) and the route
 * validator are the same definition (ADR-051). Convex validators cannot express
 * the length/count bounds; those stay enforced at the route, which is the only
 * writer. */
export const sourceMarketingV = zodToConvex(marketingSchema);

/** The four processing statuses of a Source (ADR-051). The route only ever
 * writes `processing`/`ready`; `failed` and `unavailable` are set by the
 * enrichment polling that completes the Source. */
export const sourceStatusV = v.union(
  v.literal("processing"),
  v.literal("ready"),
  v.literal("failed"),
  v.literal("unavailable"),
);

export type SourceWriteValidation =
  | { ok: true; value: { id?: string; common: SourceCommon; analysis: Record<string, unknown> } }
  | { ok: false; errors: string[] };

function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") out += `[${segment}]`;
    else out += out ? `.${String(segment)}` : String(segment);
  }
  return out;
}

function formatIssues(issues: z.core.$ZodIssue[]): string[] {
  const errors: string[] = [];
  for (const issue of issues) {
    const path = formatPath(issue.path);
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        errors.push(`${path ? `${path}.` : ""}${key}: not allowed (unknown or not writable by the Agent)`);
      }
    } else {
      errors.push(`${path || "(root)"}: ${issue.message}`);
    }
  }
  return errors;
}

function buildWriteSchema(declaration: SourceDeclaration) {
  return z.strictObject({
    templateId: z.string(),
    sourceId: z.literal(declaration.type),
    // Enrichment phase (issue #533): the `id` of the `processing` Source this
    // write completes, as returned by its first write. Absent on a first write.
    id: z.string().min(1).optional(),
    common: commonSchema,
    // The Template's declared analysis schema (validated at manifest load).
    analysis: z.fromJSONSchema(declaration.analysisSchema as z.core.JSONSchema.JSONSchema),
  });
}

/** Validate a full write payload; returns every error at once, path-prefixed. */
export function validateSourceWrite(declaration: SourceDeclaration, body: unknown): SourceWriteValidation {
  let schema: ReturnType<typeof buildWriteSchema>;
  try {
    schema = buildWriteSchema(declaration);
  } catch (error) {
    // `validateManifest` rejects unsupported keywords at Activation, so this is
    // a Template that got past it. Report it as a payload error rather than
    // letting the route 500: the Agent still gets something readable back.
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      errors: [`analysis: the Template's declared analysis schema cannot be compiled (${detail})`],
    };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, errors: formatIssues(parsed.error.issues) };
  return {
    ok: true,
    value: {
      ...(parsed.data.id !== undefined ? { id: parsed.data.id } : {}),
      common: parsed.data.common,
      analysis: parsed.data.analysis as Record<string, unknown>,
    },
  };
}

/**
 * The merged JSON Schema (common layers + the Source's analysis) for one
 * declared Source, describing the whole payload an Agent posts. Meant for
 * injection into the Agent's context.
 */
export function buildSourceJsonSchema(declaration: SourceDeclaration): Record<string, unknown> {
  const common = z.toJSONSchema(commonSchema, { io: "input" }) as Record<string, unknown>;
  delete common.$schema;
  return {
    type: "object",
    properties: {
      templateId: { type: "string" },
      sourceId: { const: declaration.type },
      // Only when completing a `processing` Source (enrichment phase): the id its first write returned.
      id: { type: "string" },
      common,
      analysis: declaration.analysisSchema,
    },
    required: ["templateId", "sourceId", "common", "analysis"],
    additionalProperties: false,
  };
}
