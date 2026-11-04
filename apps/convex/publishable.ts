import type { Validator } from "convex/values";
import { zodToConvex } from "convex-helpers/server/zod4";
import { z } from "zod";
import type { PublishableKind } from "@opengroow/agent-templates";

// The Publishable (issue #16, ADR-069): the unified format of a deliverable,
// of one kind from a closed set. References only (URLs), never content
// (ADR-010). Defined once here and derived twice, as in ADR-051: the Convex
// validator stored on the Artifact (`publishableV`, via `zodToConvex`) and the
// JSON Schema given to Agents (`publishableJsonSchema`, via `z.toJSONSchema`);
// the RunResult validator uses the zod schema itself. The list of kinds must
// match `PUBLISHABLE_KINDS` of the manifest validator (pinned by a test).

const url = z.string().url().max(2048);
const caption = z.string().max(5000);
// Free, service-neutral extras (hashtags, a title...) an adapter may use.
const metadata = z.record(z.string(), z.any()).optional();

export const videoPublishableSchema = z.strictObject({
  kind: z.literal("video"),
  videoUrl: url,
  coverUrl: url.optional(),
  title: z.string().max(500).optional(),
  caption,
  metadata,
});

export const imagePublishableSchema = z.strictObject({
  kind: z.literal("image"),
  imageUrl: url,
  caption,
  metadata,
});

export const carouselPublishableSchema = z.strictObject({
  kind: z.literal("carousel"),
  // Ordered: the first URL is the first slide.
  slideUrls: z.array(url).min(1).max(20),
  caption,
  metadata,
});

export const publishableSchema = z.discriminatedUnion("kind", [
  videoPublishableSchema,
  imagePublishableSchema,
  carouselPublishableSchema,
]);

export type Publishable = z.output<typeof publishableSchema>;

/** The Convex validator of a stored Publishable, derived from the zod schema.
 * (URL/length bounds are enforced by the RunResult validation, the only writer.) */
// Typed explicitly (the derived union type is too deep for table-wide type
// inference, which broke typing of every document read through the schema).
export const publishableV = zodToConvex(publishableSchema) as unknown as Validator<
  Publishable,
  "required",
  string
>;

const SCHEMA_BY_KIND = {
  video: videoPublishableSchema,
  image: imagePublishableSchema,
  carousel: carouselPublishableSchema,
} satisfies Record<PublishableKind, z.ZodType>;

/** The section of context.md that tells the Agent what to return (ADR-069). */
export function renderPublishableSection(kind: PublishableKind): string {
  return [
    "",
    "## Publishable",
    "",
    `This Mission type produces a \`${kind}\` deliverable. In your RunResult, set \`artifact.publishable\` to an object matching this JSON Schema (references only, never content). You never publish yourself: a human review or auto-publish does it. Do not call any publishing tool.`,
    "",
    "```json",
    JSON.stringify(publishableJsonSchema(kind), null, 2),
    "```",
    "",
  ].join("\n");
}

/** The JSON Schema of the Publishable of one kind, handed to the Agent. */
export function publishableJsonSchema(kind: PublishableKind): Record<string, unknown> {
  return z.toJSONSchema(SCHEMA_BY_KIND[kind]) as Record<string, unknown>;
}
