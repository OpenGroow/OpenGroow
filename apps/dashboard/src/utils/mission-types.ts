import type { AgentManifest, MissionPayloadField, MissionType } from "@convex/template_manifest_contract";

/**
 * Re-export so callers import the manifest types from one place.
 * `MissionType` is the canonical shape; `MissionTypeOption` is an alias kept
 * for import compatibility during migration.
 */
export type { MissionType };
export type MissionTypeOption = MissionType;

/**
 * Whether a Mission payload field's current value counts as "not filled in",
 * per its declared type (issue #336 extended this beyond text/select to
 * number). Shared by `validateMissionPayload` below and the payload form
 * renderer (`MissionPayloadFields`) so "what counts as empty" is defined
 * once instead of two independently-written type-narrowing branches.
 */
export function isMissionPayloadFieldEmpty(field: MissionPayloadField, value: unknown): boolean {
  if (field.type === "number") {
    return typeof value !== "number" || Number.isNaN(value);
  }
  return typeof value !== "string" || value.trim() === "";
}

/**
 * Validates a Mission payload against the `fields` schema declared by its
 * Mission type (issue #300), if any. Purely data-driven: looks up `type` among
 * the Template's declared `missionTypes` and checks its `fields` — never
 * branches on the type itself, so adding constraints to a new Mission type
 * never requires touching this function (GLOSSARY.md: no per-Mission-type
 * code in the dashboard).
 *
 * Mission types without a `fields` schema (or an unknown type) are
 * unconstrained here — validated downstream by the Agent or the external
 * MCP service's own schema, same as before #300.
 */
export function validateMissionPayload(args: {
  missionTypes: readonly MissionType[];
  type: string;
  payload: unknown;
}): string | null {
  const missionType = args.missionTypes.find((t) => t.type === args.type);
  const fields = missionType?.fields;
  if (!fields || fields.length === 0) return null;

  const payload = (args.payload && typeof args.payload === "object" ? args.payload : {}) as Record<string, unknown>;

  for (const field of fields) {
    const value = payload[field.key];
    const isEmpty = isMissionPayloadFieldEmpty(field, value);

    if (field.required && isEmpty) {
      return `"${field.key}" is required.`;
    }
    if (field.type === "select" && !isEmpty) {
      const allowed = field.options.map((o) => o.value);
      if (!allowed.includes(value as string)) {
        return `"${field.key}" must be one of: ${allowed.join(", ")}.`;
      }
    }
    if (field.type === "number" && !isEmpty) {
      const numericValue = value as number;
      if (field.min !== undefined && numericValue < field.min) {
        return `"${field.key}" must be at least ${field.min}.`;
      }
      if (field.max !== undefined && numericValue > field.max) {
        return `"${field.key}" must be at most ${field.max}.`;
      }
    }
  }
  return null;
}

/**
 * Same as `validateMissionPayload`, but skips the check entirely when
 * `rawMode` is true — the raw-JSON escape hatch (issue #300) deliberately
 * bypasses per-field validation. Shared by the Mission and Schedule create
 * forms so the "skip validation while editing raw JSON" rule lives in one
 * place instead of being duplicated at each call site.
 */
export function validateMissionPayloadUnlessRaw(args: {
  missionTypes: readonly MissionType[];
  type: string;
  payload: unknown;
  rawMode: boolean;
}): string | null {
  if (args.rawMode) return null;
  return validateMissionPayload(args);
}

/**
 * Returns the mission types declared in the resolved Template manifest.
 * Templates without `missionTypes` return an empty array, causing the forms
 * to fall back to a free-text type input (behaviour unchanged for unknown templates).
 */
export function missionTypesForManifest(manifest: AgentManifest): MissionType[] {
  return manifest.missionTypes ?? [];
}

/**
 * Mission types an Agent offers in its creation forms: the Template's types
 * minus the ones the operator hid (ADR-053). A deny-list, so nothing hidden
 * (absent or empty) offers every type, and names the Template no longer
 * declares are ignored. Presentation only — never a permission.
 */
export function visibleMissionTypes(missionTypes: MissionType[], hidden: readonly string[] | undefined): MissionType[] {
  if (!hidden || hidden.length === 0) return missionTypes;
  const hiddenSet = new Set(hidden);
  return missionTypes.filter((t) => !hiddenSet.has(t.type));
}
