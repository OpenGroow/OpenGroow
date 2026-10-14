import { z } from "zod";

/**
 * The result file of a SourceJob execution: a type of its own, separate from
 * the Mission `RunResult` and chosen by the Run's parent (`RunParent`). A
 * success carries the Sources the Agent normalized (validated one by one at
 * ingestion, so they stay `unknown` here); a failure carries a code and message.
 * The `in_progress` enrichment handoff (#568) carries its Sources and an
 * external job that points at one of them by `sourcePosition` (the Source has
 * no id before insertion), or at an already stored Source by `sourceRef` (its
 * id, on a resumed execution). Exactly one of the two.
 */
export const sourceRunResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("success"), summary: z.string(), sources: z.array(z.unknown()).default([]) }).strict(),
  z
    .object({
      status: z.literal("failed"),
      summary: z.string(),
      error: z.object({ code: z.string(), message: z.string() }).strict(),
    })
    .strict(),
  z
    .object({
      status: z.literal("in_progress"),
      summary: z.string(),
      sources: z.array(z.unknown()).default([]),
      // Tolerated (the Mission handoff has it) but meaningless here.
      reviewQuestions: z.array(z.string()).optional(),
      job: z
        .object({
          mcpServer: z.string(),
          jobId: z.string(),
          jobType: z.string(),
          sourcePosition: z.number().int().min(0).optional(),
          sourceRef: z.string().optional(),
        })
        .strict()
        .refine((job) => (job.sourcePosition === undefined) !== (job.sourceRef === undefined), {
          message: "job must name its Source with exactly one of sourcePosition (a Source of this result) or sourceRef (a stored Source's id)",
        }),
    })
    .strict(),
]);

export type SourceRunResult = z.output<typeof sourceRunResultSchema>;
