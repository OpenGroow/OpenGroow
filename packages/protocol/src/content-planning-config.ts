// The configuration of a `content_planning` Job (ADR-086): the planning horizon
// and the production targets per format. One pure validator, shared by the
// Convex mutation that stores it and the dashboard form that edits it.

export const DEFAULT_PLANNING_DAYS = 7;
export const MIN_PLANNING_DAYS = 1;
export const MAX_PLANNING_DAYS = 60;
/** The sum of the quantities of all targets; it also bounds one atomic write of a Content Plan. */
export const MAX_PLANNED_QUANTITY = 100;

export type ProductionTarget = { kind: string; quantity: number; publishTargets: string[] };
export type ContentPlanningConfig = { planningDays: number; productionTargets: ProductionTarget[] };

/** What the Project offers: the `publish.kind` of active Agents' Mission types, and its Publish target keys. */
export type PlanningOptions = { formats: readonly string[]; publishTargets: readonly string[] };

export function isValidPlanningDays(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_PLANNING_DAYS && value <= MAX_PLANNING_DAYS;
}

const isRecord = (raw: unknown): raw is Record<string, unknown> => !!raw && typeof raw === "object" && !Array.isArray(raw);

/** The `planningDays` of a Job config; the default when it holds none or an invalid one. */
export function planningDaysOf(config: unknown): number {
  const value = isRecord(config) ? config.planningDays : undefined;
  return isValidPlanningDays(value) ? value : DEFAULT_PLANNING_DAYS;
}

function readTarget(raw: unknown): ProductionTarget | undefined {
  if (!isRecord(raw) || typeof raw.kind !== "string" || typeof raw.quantity !== "number" || !Array.isArray(raw.publishTargets)) return undefined;
  if (!raw.publishTargets.every((key) => typeof key === "string")) return undefined;
  return { kind: raw.kind, quantity: raw.quantity, publishTargets: [...new Set(raw.publishTargets as string[])] };
}

/** The well-formed production targets stored on a Job config, as stored (not checked against the Project). */
export function productionTargetsOf(config: unknown): ProductionTarget[] {
  const list = isRecord(config) ? config.productionTargets : undefined;
  return Array.isArray(list) ? list.flatMap((raw) => readTarget(raw) ?? []) : [];
}

/** Validates a configuration to save; the errors are meant to be read by the user. */
export function validateContentPlanningConfig(
  raw: unknown,
  options: PlanningOptions,
): { ok: true; value: ContentPlanningConfig } | { ok: false; errors: string[] } {
  if (!isRecord(raw)) return { ok: false, errors: ["The configuration must be an object."] };
  const errors: string[] = [];
  if (!isValidPlanningDays(raw.planningDays)) {
    errors.push(`The planning horizon must be a whole number of days between ${MIN_PLANNING_DAYS} and ${MAX_PLANNING_DAYS}.`);
  }
  const targets: ProductionTarget[] = [];
  if (!Array.isArray(raw.productionTargets)) {
    errors.push("The production targets must be a list.");
  } else {
    const seen = new Set<string>();
    for (const entry of raw.productionTargets) {
      const target = readTarget(entry);
      if (!target) {
        errors.push("Each production target needs a format, a quantity and Publish targets.");
        continue;
      }
      if (!options.formats.includes(target.kind)) errors.push(`Unknown format "${target.kind}": no active Agent produces it.`);
      if (seen.has(target.kind)) errors.push(`The format "${target.kind}" is listed twice.`);
      seen.add(target.kind);
      if (!Number.isInteger(target.quantity) || target.quantity < 1) errors.push(`The quantity of "${target.kind}" must be a whole number, at least 1.`);
      if (target.publishTargets.length === 0) errors.push(`Choose at least one Publish target for "${target.kind}".`);
      for (const key of target.publishTargets) {
        if (!options.publishTargets.includes(key)) errors.push(`Unknown Publish target "${key}" for "${target.kind}".`);
      }
      targets.push(target);
    }
    const total = targets.reduce((sum, target) => sum + (Number.isInteger(target.quantity) && target.quantity > 0 ? target.quantity : 0), 0);
    if (total > MAX_PLANNED_QUANTITY) errors.push(`The total quantity is ${total}; it may not exceed ${MAX_PLANNED_QUANTITY}.`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { planningDays: raw.planningDays as number, productionTargets: targets } };
}

/**
 * The targets that can still be planned: their format is still produced by an active Agent and at
 * least one of their Publish targets still exists. What disappeared is reported, never stored back.
 */
export function usableTargets(
  targets: readonly ProductionTarget[],
  options: PlanningOptions,
): { usable: ProductionTarget[]; ignored: string[] } {
  const usable: ProductionTarget[] = [];
  const ignored: string[] = [];
  for (const target of targets) {
    if (!options.formats.includes(target.kind)) {
      ignored.push(`${target.kind}: no active Agent produces this format any more`);
      continue;
    }
    const kept = target.publishTargets.filter((key) => options.publishTargets.includes(key));
    const gone = target.publishTargets.filter((key) => !options.publishTargets.includes(key));
    if (gone.length > 0) ignored.push(`${target.kind}: Publish target ${gone.join(", ")} no longer exists`);
    if (kept.length > 0 && target.quantity > 0) usable.push({ ...target, publishTargets: kept });
  }
  return { usable, ignored };
}
