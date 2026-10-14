import type { AgentManifest, LeafRequirementField, RequirementField } from "./types";

/**
 * Flatten a manifest's requirement fields, expanding `group` entries into their
 * leaf fields. Single source of truth for walking `requirements` — shared by the
 * dashboard (form rendering, immutable-key derivation, edit gating) and Convex
 * (required-field validation) so the group-expansion rule lives in one place.
 */
export function flattenRequirementFields(
  requirements: RequirementField[] | undefined,
): LeafRequirementField[] {
  return (requirements ?? []).flatMap((field) =>
    field.type === "group" ? field.fields : [field],
  );
}

/** The requirement marked `deliveredToInstance` (pushed to the Instance), if any. */
export function deliveredRequirementField(manifest: AgentManifest): LeafRequirementField | undefined {
  return flattenRequirementFields(manifest.requirements).find((field) => field.deliveredToInstance);
}

/**
 * The `({key})` token a requirement's `label` may use to reference a sibling
 * field, e.g. `"Account handle ({platform})"` (issue #345). Single source of
 * truth for the grammar: the dashboard resolves it against the form's current
 * values (`resolveLabelTokens`), `validateManifest` rejects a token pointing
 * at an undeclared key (`labelTokenKeys`), and a second regex in either place
 * would let the two drift apart.
 *
 * The leading `\s*` is part of the token so an unresolved reference leaves no
 * dangling space behind — `"Account handle ({platform})"` renders as exactly
 * `"Account handle"` while no platform is chosen.
 */
const LABEL_TOKEN_PATTERN = /\s*\(\{(\w+)\}\)/g;

/** Every sibling-field key referenced by `label`'s `({key})` tokens. */
export function labelTokenKeys(label: string): string[] {
  return [...label.matchAll(LABEL_TOKEN_PATTERN)].map((match) => match[1]);
}

/**
 * Render `label`'s `({key})` tokens against the form's current `values`.
 * A `select` field resolves to its chosen option's human-readable label; any
 * other field to its raw value; an unknown key or an unfilled field drops the
 * whole `(...)` group rather than rendering an empty one.
 */
export function resolveLabelTokens(
  label: string,
  values: Record<string, string>,
  fieldsByKey: Map<string, LeafRequirementField>,
): string {
  if (!label.includes("({")) return label; // fast path: most labels carry no token
  return label.replace(LABEL_TOKEN_PATTERN, (_match, key: string) => {
    const referencedField = fieldsByKey.get(key);
    const rawValue = values[key];
    if (!referencedField || !rawValue) return "";
    if (referencedField.type === "select") {
      const option = referencedField.options.find((candidate) => candidate.value === rawValue);
      return option ? ` (${option.label})` : "";
    }
    return ` (${rawValue})`;
  });
}

/**
 * Whether an Agent can be retried via the Config Completeness status-check
 * alone (issue #320, ADR-034), rather than re-opening the activation form.
 * Single source of truth for the "Retry re-checks vs. reactivate" decision —
 * shared by the Convex `retryProjectAgentStatusCheck` action's own guard
 * (`apps/convex/project_agents_node.ts`) and the dashboard's Retry button
 * routing (`instance-agents-page.tsx`). Both need the exact same rule (a
 * Template with a `statusCheck` contract, and a non-empty stored `apiKey`);
 * computing it twice independently would let the two drift.
 */
export function hasRetryableStatusCheck(
  manifest: AgentManifest,
  config: Record<string, unknown> | undefined,
): boolean {
  return manifest.statusCheck !== undefined && typeof config?.apiKey === "string" && config.apiKey.length > 0;
}
