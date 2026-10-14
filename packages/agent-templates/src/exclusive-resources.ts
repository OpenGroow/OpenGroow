import { isPlainObject } from "./job-declarations";
import type { AgentManifest } from "./types";

/** The exclusive resources a Mission type of this Template uses (empty when none). */
export function exclusiveResourcesOf(
  manifest: Pick<AgentManifest, "exclusiveResources"> | undefined,
  missionType: string,
): string[] {
  return Object.entries(manifest?.exclusiveResources ?? {})
    .filter(([, types]) => types.includes(missionType))
    .map(([resource]) => resource);
}

/**
 * Why a raw `exclusiveResources` value is invalid, or undefined when it is
 * well-formed: a map of non-empty resource names to non-empty lists of Mission
 * types declared in the same manifest.
 */
export function exclusiveResourcesProblem(raw: unknown, missionTypes: unknown): string | undefined {
  if (!isPlainObject(raw)) return "'exclusiveResources' must be an object mapping resource names to Mission type lists";
  const declared = new Set(
    (Array.isArray(missionTypes) ? missionTypes : []).map((entry) => (entry as Record<string, unknown>).type),
  );
  if (declared.size === 0) return "'missionTypes' is required when a manifest declares 'exclusiveResources'";
  for (const [resource, types] of Object.entries(raw)) {
    const at = `exclusiveResources[${JSON.stringify(resource)}]`;
    if (!resource) return "'exclusiveResources' resource names must be non-empty";
    if (!Array.isArray(types) || types.length === 0 || !types.every((t) => typeof t === "string")) {
      return `${at} must be a non-empty array of Mission type names`;
    }
    for (const type of types) {
      if (!declared.has(type)) return `${at} references Mission type "${type}", which is not declared in 'missionTypes'`;
    }
  }
  return undefined;
}
