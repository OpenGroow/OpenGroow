import { z } from "zod";

// The result file of a Recipe Generation (ADR-087): a Recipe Proposal or "no opportunity". Pure: it checks the
// shape only; the target and the cited Sources are checked where the database is at hand.

const text = (what: string) => z.string({ error: `${what} must be a string` }).trim().min(1, `${what} must not be empty`);

const proposalSchema = z.object({
  kind: z.literal("proposal"),
  name: text("name"),
  description: text("description"),
  templateId: text("templateId"),
  missionType: text("missionType"),
  prompt: z.string().optional(),
  instructions: text("instructions"),
  constraints: z.array(z.string()).default([]),
  sourceIds: z.array(text("sourceIds[]")).default([]),
  rationale: text("rationale"),
});

export const NO_OPPORTUNITY_REASONS = ["sources_insufficient", "already_covered", "no_compatible_mission_type", "low_relevance"] as const;

const noOpportunitySchema = z.object({
  kind: z.literal("no_opportunity"),
  reason: z.enum(NO_OPPORTUNITY_REASONS, { error: `reason must be one of ${NO_OPPORTUNITY_REASONS.join(", ")}` }),
  details: z.string().optional(),
});

export type ParsedProposal = Omit<z.infer<typeof proposalSchema>, "kind">;
export type ParsedRecipeResult =
  | { ok: true; kind: "proposal"; proposal: ParsedProposal }
  | { ok: true; kind: "no_opportunity"; reason: (typeof NO_OPPORTUNITY_REASONS)[number]; details?: string }
  | { ok: false; errors: string[] };

const describe = (issues: readonly { path: PropertyKey[]; message: string }[]) =>
  issues.map((issue) => (issue.path.length > 0 ? `${issue.path.map(String).join(".")}: ${issue.message}` : issue.message));

/** Reads the Agent's result file: `{ kind: "proposal", ... }` or `{ kind: "no_opportunity", reason }`. */
export function parseRecipeResult(envelope: unknown): ParsedRecipeResult {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return { ok: false, errors: ["The result must be a JSON object."] };
  const kind = (envelope as Record<string, unknown>).kind;
  if (kind === "proposal") {
    const parsed = proposalSchema.safeParse(envelope);
    if (!parsed.success) return { ok: false, errors: describe(parsed.error.issues) };
    const { kind: _kind, ...proposal } = parsed.data;
    return { ok: true, kind: "proposal", proposal };
  }
  if (kind === "no_opportunity") {
    const parsed = noOpportunitySchema.safeParse(envelope);
    if (!parsed.success) return { ok: false, errors: describe(parsed.error.issues) };
    return { ok: true, kind: "no_opportunity", reason: parsed.data.reason, ...(parsed.data.details ? { details: parsed.data.details } : {}) };
  }
  return { ok: false, errors: [`kind must be "proposal" or "no_opportunity".`] };
}
