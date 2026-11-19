/**
 * Manifest validation for a Mission type's `analytics` declaration (issue #90,
 * ADR-078; ADR-079: the adapter declares the metrics, the Template only opts in
 * and may override the delays). Pure function over raw manifest data.
 */
import { DEFAULT_COLLECT_DELAYS_MS } from "@opengroow/publisher-sdk";

/** Delays, in days after the Publication became `published`, when neither the Template nor the adapter gives any. */
export const DEFAULT_ANALYTICS_COLLECT_DAYS: readonly number[] = DEFAULT_COLLECT_DELAYS_MS.map((ms) => ms / (24 * 60 * 60_000));

export type AnalyticsDeclaration = {
  /** Days after publication at which to read; when omitted, the adapter's delays apply. */
  collect?: number[];
  /** Ignored, with a warning (ADR-079): the adapter declares the metric that ranks its posts. */
  primaryMetric?: string;
};

/**
 * The declaration of a Mission type, or undefined when it is not measured. `collect` is the
 * Template's own delays in days, sorted; absent when the adapter's delays apply.
 * `legacyPrimaryMetric` is only used for an adapter of contract 1, which declares no `primary`.
 */
export function analyticsDeclarationFor(
  manifest: { missionTypes?: ReadonlyArray<{ type: string; analytics?: AnalyticsDeclaration }> } | undefined,
  missionType: string,
): { collect?: number[]; legacyPrimaryMetric?: string } | undefined {
  const declared = manifest?.missionTypes?.find((entry) => entry.type === missionType)?.analytics;
  if (!declared) return undefined;
  return {
    ...(declared.collect ? { collect: [...declared.collect].sort((a, b) => a - b) } : {}),
    ...(typeof declared.primaryMetric === "string" ? { legacyPrimaryMetric: declared.primaryMetric } : {}),
  };
}

/** A warning when the declaration still names `primaryMetric`, which the adapter now declares (ADR-079). */
export function analyticsDeclarationWarning(raw: unknown, at: string): string | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !("primaryMetric" in raw)) return undefined;
  return `${at}.analytics.primaryMetric is ignored: the Analytics Adapter declares the metric that ranks its posts (ADR-079). Remove it and keep \`analytics: { collect? }\``;
}

/** An actionable reason, or undefined when `analytics` is absent or valid.
 * `publishKind` is the Mission type's `publish.kind` (undefined: it does not publish). */
export function analyticsDeclarationProblem(raw: unknown, at: string, publishKind: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const where = `${at}.analytics`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return `${where} must be an object { collect? }`;
  const analytics = raw as Record<string, unknown>;
  for (const key of Object.keys(analytics)) {
    if (key !== "primaryMetric" && key !== "collect") return `${where} has unknown key "${key}"`;
  }
  if (publishKind === undefined) return `${where} needs a \`publish\` declaration: only Publications are measured`;
  if (analytics.collect !== undefined) {
    const collect = analytics.collect;
    if (!Array.isArray(collect) || collect.length === 0 || !collect.every((d) => Number.isInteger(d) && d > 0)) {
      return `${where}.collect must be a non-empty array of delays in whole days (positive integers); omit it to use the adapter's delays`;
    }
    if (new Set(collect).size !== collect.length) return `${where}.collect lists a delay twice`;
  }
  return undefined;
}
