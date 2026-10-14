import type { AgentManifest } from "@convex/template_manifest_contract";
import { flattenRequirementFields } from "@convex/template_manifest_contract";

/** Maps a flat stored config to the string values the edit form expects. */
export function flatConfig(config: Record<string, unknown> | undefined): Record<string, string> {
  if (!config) return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(config)) {
    if (typeof v === "string") result[k] = v;
  }
  return result;
}

// Read-only keys are derived from the manifest: a field marked `immutable` is
// part of the Agent's frozen config (identity) and cannot be reconfigured.
export function immutableKeys(manifest: AgentManifest): string[] {
  return flattenRequirementFields(manifest.requirements)
    .filter((field) => field.immutable)
    .map((field) => field.key);
}

// An Agent is reconfigurable from the UI when its Template supports
// reconfiguration (the server rejects any other) and it has at least one
// editable (non-immutable) requirement field.
export function hasEditableRequirements(manifest: AgentManifest): boolean {
  const supportsReconfiguration = manifest.reconfigurable === true || manifest.reconfiguration !== undefined;
  return supportsReconfiguration && flattenRequirementFields(manifest.requirements).some((field) => !field.immutable);
}
