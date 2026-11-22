// Display rules of the Creative Library (ADR-082).

/** "5 Sources", "1 Source", "100+ Sources" when the server capped the count. */
export function sourceCountLabel(family: { sourceCount: number; sourceCountCapped: boolean }): string {
  const value = family.sourceCountCapped ? `${family.sourceCount}+` : `${family.sourceCount}`;
  return `${value} ${family.sourceCount === 1 && !family.sourceCountCapped ? "Source" : "Sources"}`;
}

const METRICS = [
  { key: "viewCount", label: "Views" },
  { key: "likeCount", label: "Likes" },
  { key: "commentCount", label: "Comments" },
  { key: "shareCount", label: "Shares" },
  { key: "saveCount", label: "Saves" },
] as const;

/** The metrics a Source's analysis collected; a missing one is `null` (unknown), never 0. */
export function metricsOf(analysis: unknown): Array<{ label: string; value: number | null }> {
  const record = typeof analysis === "object" && analysis !== null ? (analysis as Record<string, unknown>) : {};
  return METRICS.map(({ key, label }) => ({ label, value: typeof record[key] === "number" ? (record[key] as number) : null }));
}

/** The post's own link: `analysis.postUrl`, else the Source's origin. */
export function postUrlOf(source: { origin: string; analysis?: unknown }): string {
  const analysis = typeof source.analysis === "object" && source.analysis !== null ? (source.analysis as Record<string, unknown>) : {};
  return typeof analysis.postUrl === "string" ? analysis.postUrl : source.origin;
}
