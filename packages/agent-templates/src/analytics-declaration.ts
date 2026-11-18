/**
 * Manifest validation for a Mission type's `analytics` declaration (issue #90,
 * ADR-078). Pure function over raw manifest data.
 */
import { isMetricOfKind, METRIC_VOCABULARY, metricKindOf } from "@opengroow/publisher-sdk";

/** Delays, in days after the Publication became `published`, when `collect` is omitted. */
export const DEFAULT_ANALYTICS_COLLECT_DAYS: readonly number[] = [1, 3, 7];

export type AnalyticsDeclaration = {
  /** A metric of the vocabulary of the kind the Mission type publishes. */
  primaryMetric: string;
  /** Days after publication at which to read; default 1, 3 and 7. */
  collect?: number[];
};

/** The declaration with defaults applied, or undefined when the Mission type is not measured. */
export function analyticsDeclarationFor(
  manifest: { missionTypes?: ReadonlyArray<{ type: string; analytics?: AnalyticsDeclaration }> } | undefined,
  missionType: string,
): { primaryMetric: string; collect: number[] } | undefined {
  const declared = manifest?.missionTypes?.find((entry) => entry.type === missionType)?.analytics;
  if (!declared) return undefined;
  return {
    primaryMetric: declared.primaryMetric,
    collect: [...(declared.collect ?? DEFAULT_ANALYTICS_COLLECT_DAYS)].sort((a, b) => a - b),
  };
}

/** An actionable reason, or undefined when `analytics` is absent or valid.
 * `publishKind` is the Mission type's `publish.kind` (undefined: it does not publish). */
export function analyticsDeclarationProblem(raw: unknown, at: string, publishKind: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const where = `${at}.analytics`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return `${where} must be an object { primaryMetric, collect? }`;
  const analytics = raw as Record<string, unknown>;
  for (const key of Object.keys(analytics)) {
    if (key !== "primaryMetric" && key !== "collect") return `${where} has unknown key "${key}"`;
  }
  if (publishKind === undefined) return `${where} needs a \`publish\` declaration: only Publications are measured`;
  const kind = metricKindOf(publishKind);
  if (!isMetricOfKind(kind, analytics.primaryMetric)) {
    return `${where}.primaryMetric ${JSON.stringify(analytics.primaryMetric)} is not a metric of kind "${publishKind}" — one of ${METRIC_VOCABULARY[kind].join(", ")}`;
  }
  if (analytics.collect !== undefined) {
    const collect = analytics.collect;
    if (!Array.isArray(collect) || collect.length === 0 || !collect.every((d) => Number.isInteger(d) && d > 0)) {
      return `${where}.collect must be a non-empty array of delays in whole days (positive integers), default ${DEFAULT_ANALYTICS_COLLECT_DAYS.join(", ")}`;
    }
    if (new Set(collect).size !== collect.length) return `${where}.collect lists a delay twice`;
  }
  return undefined;
}
