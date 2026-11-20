import { v, type Infer } from "convex/values";
import { z } from "zod";

// The Plan (ADR-081): what a Strategy Agent reports in its result file instead
// of creating Missions. At most PLAN_MAX_ITEMS items, each one a Mission the
// human may approve, with the reason and the figures that justify it.
// Kept free of server imports: the RunResult validators (and so the schema) use it.

/** To adjust once real Plans are seen (ADR-081). */
export const PLAN_MAX_ITEMS = 5;

export const planItemSchema = z.strictObject({
  /** The Mission type to create. */
  type: z.string().min(1),
  /** The done, measured Mission this item starts from: the `missionId` that `list_publications` returns. */
  basedOn: z.string().min(1),
  /** The payload of the Mission, exactly as a manual creation would send it. */
  payload: z.record(z.string(), z.unknown()),
  /** Why this Mission, in a sentence a human can judge. */
  reason: z.string().min(1),
  /** The numbers the reason rests on, e.g. `{ label: "Reels, median views", value: 1200 }`. At least one. */
  figures: z.array(z.strictObject({ label: z.string().min(1), value: z.union([z.string(), z.number()]) })).min(1),
});

export const planItemV = v.object({
  type: v.string(),
  // Optional in storage only: Plans stored before `basedOn` existed must still match the schema. New Plans require it (planItemSchema).
  basedOn: v.optional(v.string()),
  payload: v.any(),
  reason: v.string(),
  figures: v.array(v.object({ label: v.string(), value: v.union(v.string(), v.number()) })),
});

export type PlanItem = Infer<typeof planItemV>;

/** The count rule, checked on a Plan that already has the right shape. Same wording for the Agent and the human. */
export function planSizeError(items: readonly unknown[]): string | undefined {
  return items.length > PLAN_MAX_ITEMS
    ? `plan has ${items.length} items: at most ${PLAN_MAX_ITEMS} are allowed, keep the ones that matter most`
    : undefined;
}
