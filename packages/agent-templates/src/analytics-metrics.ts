/**
 * The closed metric vocabulary of Performance Snapshots (ADR-078), per kind of
 * measured content. Owned by OpenGroow: adding a metric is a product change.
 * Standalone on purpose (no import) so it can be merged with the metric
 * vocabulary of the Analytics Adapter contract in the SDK (#88).
 */
export const ANALYTICS_METRICS = {
  social: ["views", "reach", "likes", "comments", "shares", "saves"],
  article: ["pageviews", "visitors", "engagementTime"],
} as const;

export type AnalyticsKind = keyof typeof ANALYTICS_METRICS;
export type AnalyticsMetric = (typeof ANALYTICS_METRICS)[AnalyticsKind][number];

/** The analytics kind of a Publishable kind: an article is measured as an
 * article; video, image and carousel as social content. */
export function analyticsKindOfPublishable(publishableKind: string): AnalyticsKind {
  return publishableKind === "article" ? "article" : "social";
}

export function isMetricOfKind(kind: AnalyticsKind, metric: unknown): boolean {
  return (ANALYTICS_METRICS[kind] as readonly unknown[]).includes(metric);
}
