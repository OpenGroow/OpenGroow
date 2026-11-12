import type { Validator } from "convex/values";
import { zodToConvex } from "convex-helpers/server/zod4";
import { z } from "zod";
import type { PublishableKind } from "@opengroow/agent-templates";
import { matchPlatform } from "@opengroow/publisher-sdk";

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
// Optional, service-neutral extras; an adapter forwards what its service supports.
const link = url; // destination URL (Pinterest pin)
const altText = z.string().max(1000); // image alt text
const tags = z.array(z.string().min(1).max(100)).max(30); // YouTube tags
const metadata = z.record(z.string(), z.any()).optional();

export const videoPublishableSchema = z.strictObject({
  kind: z.literal("video"),
  videoUrl: url,
  coverUrl: url.optional(),
  title: z.string().max(500).optional(),
  caption,
  link: link.optional(),
  tags: tags.optional(),
  metadata,
});

// Per-platform content of an image or carousel (ADR-073): the same content
// rendered once per platform (aspect ratio, safe zones) with that platform's own
// text, keyed by the channel's platform (`instagram`, `tiktok`, `pinterest`...).
// A variant carries a complete set of media and may override the text fields
// of the Publishable. The key is free: the MCP decides which platforms it serves.
const platformKey = z.string().min(1).max(50);
const variantText = {
  caption: caption.optional(),
  title: z.string().max(500).optional(),
  link: link.optional(),
  altText: altText.optional(),
};
const imageVariant = z.strictObject({ imageUrl: url, ...variantText });
const carouselVariant = z.strictObject({ slideUrls: z.array(url).min(1).max(20), ...variantText });

// Without refinement: `omit` (the Agent's text part) is not allowed on a refined object.
const imageBase = z.strictObject({
  kind: z.literal("image"),
  // The media is `imageUrl` or `variants`, never neither (see the refinement below).
  imageUrl: url.optional(),
  variants: z.record(platformKey, imageVariant).optional(),
  caption,
  link: link.optional(),
  altText: altText.optional(),
  metadata,
});

const carouselBase = z.strictObject({
  kind: z.literal("carousel"),
  // Ordered: the first URL is the first slide.
  slideUrls: z.array(url).min(1).max(20).optional(),
  variants: z.record(platformKey, carouselVariant).optional(),
  caption,
  link: link.optional(),
  altText: altText.optional(),
  metadata,
});

const NO_MEDIA = "needs media: set the default media or at least one variant";
export const imagePublishableSchema = imageBase.refine(
  (p) => p.imageUrl !== undefined || Object.keys(p.variants ?? {}).length > 0,
  { message: `an image ${NO_MEDIA} (imageUrl or variants)`, path: ["imageUrl"] },
);
export const carouselPublishableSchema = carouselBase.refine(
  (p) => p.slideUrls !== undefined || Object.keys(p.variants ?? {}).length > 0,
  { message: `a carousel ${NO_MEDIA} (slideUrls or variants)`, path: ["slideUrls"] },
);

// A site article (ADR-074): a markdown page and its cover, committed by a
// GitHub Publisher. The MCP that produced it owns the whole Publishable: it
// comes from `publish.resource`, the Agent writes none of it.
const slug = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be lowercase letters, digits and single hyphens (a URL path segment)");
export const articlePublishableSchema = z.strictObject({
  kind: z.literal("article"),
  markdownUrl: url,
  coverUrl: url,
  slug,
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(1000),
  category: z.string().min(1).max(100).optional(),
  metadata,
});

export const publishableSchema = z.discriminatedUnion("kind", [
  videoPublishableSchema,
  imagePublishableSchema,
  carouselPublishableSchema,
  articlePublishableSchema,
]);

export type Publishable = z.output<typeof publishableSchema>;

/**
 * The text part of a Publishable: what an Agent writes in the `in_progress`
 * RunResult of an asynchronous MCP. The media (`videoUrl`, `coverUrl`,
 * `imageUrl`, `slideUrls`) is rejected here, it comes from the MCP through
 * `publish.resource` when the External Job completes.
 */
export const publishableDraftSchema = z.discriminatedUnion("kind", [
  videoPublishableSchema.omit({ videoUrl: true, coverUrl: true }),
  imageBase.omit({ imageUrl: true, variants: true }),
  carouselBase.omit({ slideUrls: true, variants: true }),
  // An `article` has no text part (the MCP owns all of it, ADR-074). Accepted
  // here only so the reconciliation refuses it with the rule, not a schema error.
  z.looseObject({ kind: z.literal("article") }),
]);

export type PublishableDraft = z.output<typeof publishableDraftSchema>;

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
  image: imageBase,
  carousel: carouselBase,
  article: articlePublishableSchema,
} satisfies Record<PublishableKind, z.ZodType>;

/**
 * The Publishable as one channel receives it (ADR-073). With `variants`, the
 * channel's variant replaces the media and overrides the text; without a
 * variant for that platform, the default media (`slideUrls`/`imageUrl`) is kept.
 * `variants` never reaches a Publisher plugin. Pure.
 * `error`: the channel has no media at all (a Publishable made of variants
 * that does not serve this platform).
 */
export function publishableForPlatform(
  publishable: Record<string, unknown>,
  platform: string | undefined,
): { ok: true; publishable: Record<string, unknown> } | { ok: false; error: string } {
  const { variants, ...rest } = publishable;
  const served = variants && typeof variants === "object" ? (variants as Record<string, unknown>) : {};
  const key = matchPlatform(Object.keys(served), platform);
  if (key) return { ok: true, publishable: { ...rest, ...(served[key] as Record<string, unknown>) } };
  const offered = Object.keys(served);
  // No variants at all (a video, or media given once) or a default media: as is.
  if (offered.length === 0 || rest.slideUrls !== undefined || rest.imageUrl !== undefined) {
    return { ok: true, publishable: rest };
  }
  return {
    ok: false,
    error: `this ${String(publishable.kind)} was made for ${offered.join(", ")} only, it has no media for ${platform ?? "this channel"}`,
  };
}

/** The section of context.md that tells the Agent what to return (ADR-069). */
export function renderPublishableSection(
  kind: PublishableKind,
  options: { require?: readonly string[] } = {},
): string {
  const required = options.require ?? [];
  if (kind === "article") {
    return [
      "",
      "## Publishable",
      "",
      "This Mission type produces an `article` deliverable. Do not write `publishable` in your RunResult: OpenGroow gets the whole article (markdown, cover, slug, title, description) from the MCP when its job completes, and a RunResult carrying one is rejected. You never publish yourself: a human review or auto-publish does it. Do not call any publishing tool.",
      "",
    ].join("\n");
  }
  return [
    "",
    "## Publishable",
    "",
    `This Mission type produces a \`${kind}\` deliverable. In your RunResult, set \`artifact.publishable\` to an object matching this JSON Schema (references only, never content). You never publish yourself: a human review or auto-publish does it. Do not call any publishing tool.`,
    ...(kind === "image" || kind === "carousel"
      ? [
          "",
          `Media: give the default \`${kind === "image" ? "imageUrl" : "slideUrls"}\` or \`variants\` (one entry per platform the content was made for, each with its own media and optionally its own \`caption\`, \`title\`, \`link\`, \`altText\`), at least one of the two. A channel without a variant gets the default media; with variants only, a channel they do not name cannot be published to.`,
        ]
      : []),
    ...(required.length > 0
      ? [
          "",
          `This Mission type also requires these normally optional fields (the RunResult is rejected without them): ${required.map((f) => `\`${f}\``).join(", ")}.`,
        ]
      : []),
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
