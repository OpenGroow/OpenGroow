// Pure rules of a Creative Connection (issue #137): validation of a target
// against an installed manifest, and the compatibility match on a payload.
// No Convex imports.

/** The provider a Mission type declares to say it can consume a recipe. */
export const RECIPE_PROVIDER = "production-recipe";

export type CompatibleWhen = Record<string, string[]>;

type ManifestLike = {
  missionTypes?: Array<{
    type: string;
    contextProviders?: string[];
    fields?: Array<{ key: string; type: string; options?: Array<{ value: string }> }>;
  }>;
};

/** Throws unless the Mission type exists, declares the provider, and every `compatibleWhen` entry is a select field with declared options. */
export function validateConnectionTarget(manifest: ManifestLike, missionType: string, compatibleWhen: CompatibleWhen): void {
  const type = manifest.missionTypes?.find((t) => t.type === missionType);
  if (!type) throw new Error(`Mission type "${missionType}" does not exist in this Template`);
  if (!type.contextProviders?.includes(RECIPE_PROVIDER)) {
    throw new Error(`Mission type "${missionType}" does not declare the ${RECIPE_PROVIDER} provider`);
  }
  for (const [key, values] of Object.entries(compatibleWhen)) {
    const field = type.fields?.find((f) => f.key === key);
    if (!field || field.type !== "select") throw new Error(`"${key}" is not a select field of Mission type "${missionType}"`);
    if (values.length === 0) throw new Error(`"${key}" needs at least one allowed value`);
    const options = new Set((field.options ?? []).map((o) => o.value));
    for (const value of values) {
      if (!options.has(value)) throw new Error(`"${value}" is not an option of field "${key}"`);
    }
  }
}

/** True when every listed field of the payload holds one of its allowed values; a missing field is incompatible. */
export function isCompatible(compatibleWhen: CompatibleWhen, payload: unknown): boolean {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return Object.entries(compatibleWhen).every(([key, values]) => {
    const value = record[key];
    return typeof value === "string" && values.includes(value);
  });
}
