import type { AgentManifest, AgentSkillSource, TemplateSkillDeclaration } from "./types";

/** Who caused a persisted skill entry to exist: a Template requirement, or a future user-added skill. */
export type AgentSkillOrigin = "template" | "user";

/** Latest-known install state for a persisted skill entry. */
export type AgentSkillStatus = "installed" | "error";

/**
 * The latest-known-state mirror of an installed Agent Skill, persisted on
 * `projectAgents.skills[]` (issue #222).
 */
export type ProjectAgentSkill = {
  source: AgentSkillSource;
  spec: string;
  origin: AgentSkillOrigin;
  status: AgentSkillStatus;
  updatedAt: number;
  version?: string;
  errorMessage?: string;
};

/** The outcome of attempting to install one required Template skill. */
export type SkillInstallOutcome = {
  source: AgentSkillSource;
  spec: string;
  status: AgentSkillStatus;
  version?: string;
  errorMessage?: string;
};

/**
 * A skill is unique per Agent by `source` + `spec` (product decision, issue
 * #224) — `origin` is not part of identity. This is the single key format
 * both required Template skills (issue #222) and user-added skills (issue
 * #224) use to find-or-replace an entry in the `skills[]` mirror.
 */
export function skillKey(skill: { source: AgentSkillSource; spec: string }): string {
  return `${skill.source}:${skill.spec}`;
}

/** Find the persisted skill entry with the same `source` + `spec`, regardless of `origin`. */
export function findSkillByKey(
  skills: ProjectAgentSkill[],
  source: AgentSkillSource,
  spec: string,
): ProjectAgentSkill | undefined {
  const key = skillKey({ source, spec });
  return skills.find((skill) => skillKey(skill) === key);
}

/**
 * Replace the persisted entry with the same `source` + `spec` as `entry`, or
 * append it if none exists yet. Used by `addAgentSkill` (issue #224) to keep
 * the "no duplicate rows per source+spec" invariant without re-deriving the
 * key format.
 */
export function upsertSkillEntry(
  existingSkills: ProjectAgentSkill[],
  entry: ProjectAgentSkill,
): ProjectAgentSkill[] {
  const key = skillKey(entry);
  return [...existingSkills.filter((skill) => skillKey(skill) !== key), entry];
}

/**
 * Resolve the Template's currently required skills, trimming each `spec`
 * (trim only — never lowercased or otherwise normalized, per product
 * decision) and de-duplicating by `source` + trimmed `spec`.
 */
export function getRequiredTemplateSkills(manifest: AgentManifest): TemplateSkillDeclaration[] {
  const declared = manifest.skills ?? [];
  const bySkillKey = new Map<string, TemplateSkillDeclaration>();
  for (const skill of declared) {
    const trimmed: TemplateSkillDeclaration = { source: skill.source, spec: skill.spec.trim() };
    bySkillKey.set(skillKey(trimmed), trimmed);
  }
  return Array.from(bySkillKey.values());
}

/**
 * Reconcile the persisted `skills[]` mirror with fresh install outcomes for
 * the Template's currently required skills (issue #222).
 *
 * - An outcome replaces any existing entry with the same `source` + `spec`
 *   (no duplicates).
 * - Existing `origin: "template"` entries that are no longer declared by the
 *   Template (i.e. have no matching outcome and aren't in `requiredSkills`)
 *   are dropped from the mirror — the Template no longer requires them.
 * - Existing `origin: "user"` entries are left untouched; this MVP never
 *   installs or removes user-added skills.
 */
export function reconcileTemplateSkillsMirror(
  existingSkills: ProjectAgentSkill[],
  requiredSkills: TemplateSkillDeclaration[],
  outcomes: SkillInstallOutcome[],
  now: number,
): ProjectAgentSkill[] {
  const requiredKeys = new Set(requiredSkills.map(skillKey));
  const kept = existingSkills.filter(
    (skill) => skill.origin !== "template" || requiredKeys.has(skillKey(skill)),
  );

  const bySkillKey = new Map(kept.map((skill) => [skillKey(skill), skill]));
  for (const outcome of outcomes) {
    bySkillKey.set(skillKey(outcome), {
      source: outcome.source,
      spec: outcome.spec,
      origin: "template",
      status: outcome.status,
      updatedAt: now,
      version: outcome.version,
      errorMessage: outcome.errorMessage,
    });
  }
  return Array.from(bySkillKey.values());
}
