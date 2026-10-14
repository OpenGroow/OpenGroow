import type { Doc } from "./_generated/dataModel.js";

// Read paths of the scoring / selection / production pipeline over Sources
// (issue #535). The pipeline was written against `observations` rows; a
// social Source carries the same information in `analysis` (social fields) and
// `scoring` (rubric and engagement scores), and these accessors are the only
// place that knows where.

type Source = Doc<"sources">;

function analysisRecord(source: Source): Record<string, unknown> {
  const analysis: unknown = source.analysis;
  return typeof analysis === "object" && analysis !== null && !Array.isArray(analysis)
    ? (analysis as Record<string, unknown>)
    : {};
}

export type EngagementCounts = {
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  saveCount?: number;
};

function count(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function engagementCountsOf(source: Source): EngagementCounts {
  const analysis = analysisRecord(source);
  return {
    viewCount: count(analysis.viewCount),
    likeCount: count(analysis.likeCount),
    commentCount: count(analysis.commentCount),
    shareCount: count(analysis.shareCount),
    saveCount: count(analysis.saveCount),
  };
}

/** The post's own link: `analysis.postUrl`, else the Source's `origin`. */
export function postUrlOf(source: Source): string {
  const postUrl = analysisRecord(source).postUrl;
  return typeof postUrl === "string" ? postUrl : source.origin;
}

export function creativeFeaturesOf(source: Source): Record<string, unknown> | undefined {
  const features = analysisRecord(source).creativeFeatures;
  return typeof features === "object" && features !== null && !Array.isArray(features)
    ? (features as Record<string, unknown>)
    : undefined;
}

/** The social platform, derived from the declared Source id. */
export function platformOf(source: Source): "instagram" | "tiktok" | undefined {
  if (source.sourceId === "instagram-reel") return "instagram";
  if (source.sourceId === "tiktok-post") return "tiktok";
  return undefined;
}

/** A named entry of the Source's `scoring` record, `undefined` when unscored. */
export function scoreOf(source: Source, key: string): number | undefined {
  return source.scoring?.[key];
}

export function stringOf(source: Source, key: string): string | undefined {
  const value = analysisRecord(source)[key];
  return typeof value === "string" ? value : undefined;
}

/** The deep-analysis object the planning context renders (`hook`, `pacing`…),
 * `undefined` until an enrichment wrote at least its `hook`. */
export function deepAnalysisOf(source: Source) {
  const analysis = analysisRecord(source);
  if (typeof analysis.hook !== "string") return undefined;
  return {
    structureType: analysis.structureType as "narrative" | "montage" | "other" | undefined,
    hook: analysis.hook,
    pacing: stringOf(source, "pacing") ?? "",
    narrativeStructure: stringOf(source, "narrativeStructure") ?? "",
    payoff: stringOf(source, "payoff") ?? "",
    cta: stringOf(source, "cta") ?? "",
  };
}
