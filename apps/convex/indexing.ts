import { v, type Infer } from "convex/values";
import { z } from "zod";

/**
 * Verbatim mirror of the `indexing` outcome returned by the article MCP's
 * `POST /articles/:id/publish` (see ADR-015). The error message is stored as-is,
 * never reinterpreted. Discriminated by `status` so adding a provider or status
 * stays additive on the validator.
 */
export const indexingOutcomeZ = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("submitted"),
      provider: z.string(),
      taskId: z.string(),
    })
    .strict(),
  z
    .object({
      status: z.literal("error"),
      error: z.string(),
    })
    .strict(),
  z
    .object({
      status: z.literal("skipped"),
    })
    .strict(),
]);

export const indexingOutcomeV = v.union(
  v.object({
    status: v.literal("submitted"),
    provider: v.string(),
    taskId: v.string(),
  }),
  v.object({
    status: v.literal("error"),
    error: v.string(),
  }),
  v.object({
    status: v.literal("skipped"),
  }),
);

export type IndexingOutcome = Infer<typeof indexingOutcomeV>;
