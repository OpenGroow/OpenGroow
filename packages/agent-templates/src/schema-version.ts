/**
 * Profile schema versions (ADR-091). Pure and browser-safe: the dashboard and
 * Convex ask the same question, "can a new Run start from this Template
 * version?", from the manifest stored with it.
 */

/** The profile schema version this deployment writes: `kind` on every Mission type and Bundled Recipes. */
export const CURRENT_PROFILE_SCHEMA_VERSION = 2;

/**
 * Schema versions this deployment reads. Version 1 stays readable so the
 * history of a stored version (Missions, Runs, Artifacts, Publications, Recipe
 * Snapshots) keeps resolving; it is outdated, not executable.
 */
export const SUPPORTED_PROFILE_SCHEMA_VERSIONS: readonly number[] = [1, 2];

/** The first profile schema version a new Run may start from. */
export const MIN_RUNNABLE_PROFILE_SCHEMA_VERSION = 2;

/**
 * The schema version a manifest was read under. A manifest stored before the
 * reader recorded it (`schemaVersion` absent) is version 1.
 */
export function profileSchemaVersionOf(manifest: { schemaVersion?: number }): number {
  return manifest.schemaVersion ?? 1;
}

/**
 * Whether a new Run may start from a stored Template version. Derived from the
 * stored manifest, never stored itself: a version below 2 is outdated, readable
 * for history but never executed again until the Project updates the Template.
 */
export function isTemplateVersionRunnable(manifest: { schemaVersion?: number }): boolean {
  return profileSchemaVersionOf(manifest) >= MIN_RUNNABLE_PROFILE_SCHEMA_VERSION;
}
