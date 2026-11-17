import { v } from "convex/values";

// The routing decision kept on a Source (ADR-076). It outlives the routing Job
// Run, so the dashboard can show which producer was chosen, why, and which
// other producers were eligible. Kept in its own module so `schema.ts` can
// import the validator without pulling in the routing Job's server code.

export const routingCandidateV = v.object({
  templateId: v.string(),
  agentName: v.string(),
  missionType: v.string(),
  label: v.string(),
  description: v.string(),
});

export const routingDecisionV = v.object({
  // `proposed`: waiting for a human (review mode). `approved`: a production
  // Mission exists (created by the agent in auto mode, or on approval).
  // `rejected`: a human discarded the proposal; no Mission is created.
  state: v.union(v.literal("proposed"), v.literal("approved"), v.literal("rejected")),
  // Who moved the decision to its current state.
  decidedBy: v.union(v.literal("agent"), v.literal("user")),
  templateId: v.string(),
  agentName: v.string(),
  missionType: v.string(),
  label: v.string(),
  // The Mission payload exactly as it will be created (for a `create_reel`:
  // `{ publish, observationId }`, see ADR-071).
  payload: v.any(),
  // The routing Agent's own explanation (the RunResult summary).
  rationale: v.string(),
  // Every producer that was eligible when the decision was made.
  candidates: v.array(routingCandidateV),
  proposedAt: v.number(),
  decidedAt: v.optional(v.number()),
});
