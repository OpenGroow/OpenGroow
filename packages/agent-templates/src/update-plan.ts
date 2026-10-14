import { buildInstallationPlan } from "./installation-plan";
import { flattenRequirementFields } from "./requirements";
import type { AgentManifest, LeafRequirementField } from "./types";

/**
 * What updating an installed Template from one version to another changes for
 * the Project, shown before the user confirms (#669). Pure and derived from the
 * two versions' manifests (plus the ids of the plugins they ship), so Convex
 * and the dashboard agree on it. It reuses `buildInstallationPlan` for the
 * hosts, secrets and skills of each side instead of recomputing them.
 */
export type UpdatePlanSide = {
  version: string;
  manifest: AgentManifest;
  /** Ids of the OpenClaw plugins the version ships (`plugins/<id>/`). */
  pluginIds: string[];
};

export type UpdatePlanField = { key: string; label: string };

export type UpdatePlan = {
  fromVersion: string;
  toVersion: string;
  mcpHosts: {
    added: string[];
    removed: string[];
    /** Servers present in both versions whose hosts differ. */
    changed: { server: string; from: string[]; to: string[] }[];
  };
  newSecrets: { key: string; label: string; required: boolean }[];
  newPlugins: string[];
  newSkills: string[];
  /** Fields required now that were absent or optional before: the Agent's config may lack them. */
  newRequiredFields: UpdatePlanField[];
  /** Immutable (frozen at activation) fields that are new or newly frozen: they only take effect through a re-activation. */
  reactivationFields: UpdatePlanField[];
  removedMissionTypes: string[];
  /** Removed Mission types a Schedule still creates Missions of, with how many Schedules. */
  removedMissionTypesInUse: { type: string; schedules: number }[];
  /** Whether anything the user should read before confirming changes. */
  requiresAttention: boolean;
};

const without = <T>(items: readonly T[], excluded: readonly T[]): T[] => items.filter((item) => !excluded.includes(item));

function hostsByServer(manifest: AgentManifest): Map<string, string[]> {
  return new Map(
    manifest.mcpServers.map((server) => [
      server.name,
      buildInstallationPlan({ ...manifest, requirements: [], skills: [], mcpServers: [server] }).mcpHosts,
    ]),
  );
}

function fieldsByKey(manifest: AgentManifest): Map<string, LeafRequirementField> {
  return new Map(flattenRequirementFields(manifest.requirements).map((field) => [field.key, field]));
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((item, i) => item === b[i]);

/**
 * `scheduledMissionTypes` lists the Mission type of each Schedule of the
 * Template in the Project (one entry per Schedule, duplicates counted).
 */
export function buildUpdatePlan(from: UpdatePlanSide, to: UpdatePlanSide, scheduledMissionTypes: readonly string[]): UpdatePlan {
  const before = buildInstallationPlan(from.manifest);
  const after = buildInstallationPlan(to.manifest);

  const serversBefore = hostsByServer(from.manifest);
  const changed = [...hostsByServer(to.manifest)].flatMap(([server, toHosts]) => {
    const fromHosts = serversBefore.get(server);
    return fromHosts && !sameList(fromHosts, toHosts) ? [{ server, from: fromHosts, to: toHosts }] : [];
  });

  const oldFields = fieldsByKey(from.manifest);
  const newFields = [...fieldsByKey(to.manifest).values()];
  const asField = ({ key, label }: LeafRequirementField): UpdatePlanField => ({ key, label });

  const typesBefore = (from.manifest.missionTypes ?? []).map((t) => t.type);
  const typesAfter = (to.manifest.missionTypes ?? []).map((t) => t.type);
  const removedMissionTypes = without(typesBefore, typesAfter);
  const removedMissionTypesInUse = removedMissionTypes.flatMap((type) => {
    const schedules = scheduledMissionTypes.filter((scheduled) => scheduled === type).length;
    return schedules > 0 ? [{ type, schedules }] : [];
  });

  const plan = {
    fromVersion: from.version,
    toVersion: to.version,
    mcpHosts: {
      added: without(after.mcpHosts, before.mcpHosts),
      removed: without(before.mcpHosts, after.mcpHosts),
      changed,
    },
    newSecrets: after.secrets.filter((secret) => !before.secrets.some((known) => known.key === secret.key)),
    newPlugins: without(to.pluginIds, from.pluginIds),
    newSkills: without(after.skills, before.skills),
    newRequiredFields: newFields.filter((field) => field.required === true && oldFields.get(field.key)?.required !== true).map(asField),
    reactivationFields: newFields.filter((field) => field.immutable === true && oldFields.get(field.key)?.immutable !== true).map(asField),
    removedMissionTypes,
    removedMissionTypesInUse,
  };
  const requiresAttention =
    plan.mcpHosts.added.length + plan.mcpHosts.removed.length + plan.mcpHosts.changed.length > 0 ||
    plan.newSecrets.length + plan.newPlugins.length + plan.newSkills.length > 0 ||
    plan.newRequiredFields.length + plan.reactivationFields.length > 0 ||
    plan.removedMissionTypes.length > 0;
  return { ...plan, requiresAttention };
}

function numericParts(version: string): number[] | null {
  const parts = version.split(".");
  return parts.every((part) => /^\d+$/.test(part)) ? parts.map(Number) : null;
}

/**
 * Whether `candidate` is a newer version than `current`. Dotted numeric
 * versions are compared numerically; any other version string cannot be
 * ordered, so a different one counts as newer (the user still confirms).
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  if (candidate === current) return false;
  const a = numericParts(candidate);
  const b = numericParts(current);
  if (!a || !b) return true;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}
