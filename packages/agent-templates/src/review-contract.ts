import type { AgentBlocker, AgentManifest, ReviewContentContract } from "./types";

function missionTypeEntry(manifest: AgentManifest, missionType: string) {
  return manifest.missionTypes?.find((entry) => entry.type === missionType);
}

/**
 * Resolves the review content contract for a given mission type.
 * Looks up the explicit contract on the matching Mission type. There is no
 * Template-wide fallback: review behavior belongs to the Mission type.
 *
 * Kept in its own module (no `node:fs`/`node:path` imports, unlike
 * `./index.ts`) so it stays safe to import from a browser bundle — the
 * dashboard needs it client-side to decide whether to show the `autoPublish`
 * toggle (issue #328).
 */
export function resolveReviewContract(
  manifest: AgentManifest,
  missionType: string,
): ReviewContentContract | undefined {
  return missionTypeEntry(manifest, missionType)?.review;
}

/** Resolves a declared blocker for a Mission type. */
export function resolveBlocker(
  manifest: AgentManifest,
  missionType: string,
  blockerCode: string,
): AgentBlocker | undefined {
  return missionTypeEntry(manifest, missionType)?.blockers?.find(
    (blocker) => blocker.code === blockerCode,
  );
}

/**
 * Whether a Template supports `autoPublish` for a given mission type: its
 * resolved review contract must declare both a `to_validate`-gated action
 * (the "approve" step) and an `approved`-gated action (the "publish" step).
 * There is no declarative manifest field for this — the capability is
 * entirely derived from the existing `reviewContract.actions`, so it can
 * never drift from what the human review flow can actually do (issue #328,
 * PRD #326).
 */
export function templateSupportsAutoPublish(manifest: AgentManifest, missionType: string): boolean {
  const actions = resolveReviewContract(manifest, missionType)?.actions;
  if (!actions) return false;
  const hasToValidate = actions.some((action) => action.requiredStatus === "to_validate");
  const hasApproved = actions.some((action) => action.requiredStatus === "approved");
  return hasToValidate && hasApproved;
}
