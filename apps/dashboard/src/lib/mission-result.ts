import type { Doc } from "@convex/_generated/dataModel";

// Shared RunResult narrowing helpers for Mission surfaces (Kanban card, Mission
// detail page). Kept in one place so the two views can't silently diverge on
// what counts as "blocked" or "reviewable" (issue #323).

type MissionLike = Pick<Doc<"missions">, "status" | "lastResult">;

/**
 * `blocked_external` — a human-action blocker declared by an Agent Template,
 * not a OpenGroow error. Distinct treatment from `failed` (not red) and from
 * `to_validate` (nothing to review inside OpenGroow), see issue #323.
 */
export function blockedExternalResult(
  mission: MissionLike,
): {
  blockerCode: string;
  message: string;
  resolution?:
    | { kind: "link"; url: string }
    | { kind: "execution_device" };
} | undefined {
  if (mission.status !== "blocked") return undefined;
  const result = mission.lastResult;
  if (!result || result.status !== "blocked_external") return undefined;
  return {
    blockerCode: result.blockerCode,
    message: result.message,
    ...(result.resolution !== undefined ? { resolution: result.resolution } : {}),
  };
}
