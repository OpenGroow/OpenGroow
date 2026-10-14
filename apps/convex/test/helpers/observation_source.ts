import type { DatabaseWriter } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";

/**
 * The Observation-shaped row the scoring, selection and planning tests were
 * written against. The `observations` table is gone (issue #537); this type
 * only describes a fixture, mapped to the Source it corresponds to.
 */
export type ObservationFixture = {
  ownerId: string;
  instanceId: string;
  missionId: Id<"missions">;
  runId: Id<"runs">;
  platform: "instagram" | "tiktok";
  sourceAccount: string;
  likeCount?: number;
  viewCount?: number;
  commentCount?: number;
  shareCount?: number;
  saveCount?: number;
  description: string;
  postUrl: string;
  capturedAt: number;
  createdAt: number;
  trigger?: "liked" | "saved" | "commented" | "high_performance";
  contentFeatures?: { topics: string[]; audience?: string[]; emotion?: string[]; intent?: string };
  creativeFeatures?: Record<string, unknown>;
  analysis?: Record<string, unknown>;
  creativeMechanic?: string;
  informationCarrier?: Array<"text" | "visuals" | "speech">;
  reproducibleElements?: string[];
  topicSpecificElements?: string[];
  transcriptRef?: string;
  rawData?: string;
  enrichmentStatus?: "pending" | "completed" | "failed" | "unavailable";
  enrichedAt?: number;
  enrichmentAnalyzer?: string;
  productFit?: number;
  replicability?: number;
  creativeStrength?: number;
  creativeFamilyId?: Id<"creativeFamilies">;
  rawEngagementScore?: number;
  excluded?: boolean;
  selectedAt?: number;
  producedAt?: number;
  publishedAt?: number;
  productionMissionId?: Id<"missions">;
  delegateMissionId?: Id<"missions">;
  engagementScore?: number;
  replicationScore?: number;
};

// The Source declarations the social pipeline code keys on (`platformOf`). They
// mirror the Sources declared by a real social Template and are deliberately
// frozen here for the pipeline tests, not read from a Template package: no
// package versioned in this repository declares them. If `platformOf` changes,
// update these values by hand.
const SOURCE_BY_PLATFORM = {
  instagram: { type: "instagram-reel", label: "Instagram Reel", family: "social-video" },
  tiktok: { type: "tiktok-post", label: "TikTok post", family: "social-video" },
} as const;
const STATUS_BY_ENRICHMENT = {
  completed: "ready",
  pending: "processing",
  failed: "failed",
  unavailable: "unavailable",
} as const;

type SourceInsert = Omit<Doc<"sources">, "_id" | "_creationTime">;

function compact<T extends Record<string, unknown>>(record: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

/**
 * Seeds a Source the way it looks in production for the social pipeline: the
 * Observation-shaped fixture is mapped to a `sources` row (social fields in
 * `analysis`, content features in `marketing`, scores in `scoring`, selection
 * and production fields as flat columns). Returns the Source's id.
 */
export async function insertObservationAsSource(
  ctx: { db: DatabaseWriter },
  row: ObservationFixture,
): Promise<Id<"sources">> {
  const declaration = SOURCE_BY_PLATFORM[row.platform];

  const marketing = compact({
    topics: row.contentFeatures?.topics,
    audiences: row.contentFeatures?.audience,
    emotions: row.contentFeatures?.emotion,
    intent: row.contentFeatures?.intent,
    reproducibleElements: row.reproducibleElements,
    topicSpecificElements: row.topicSpecificElements,
  });
  const analysis = compact({
    postUrl: row.postUrl,
    accountHandle: row.sourceAccount,
    relevanceReason: row.description,
    trigger: row.trigger,
    likeCount: row.likeCount,
    viewCount: row.viewCount,
    commentCount: row.commentCount,
    shareCount: row.shareCount,
    saveCount: row.saveCount,
    creativeFeatures: row.creativeFeatures,
    ...row.analysis,
    creativeMechanic: row.creativeMechanic,
    informationCarrier: row.informationCarrier,
    transcriptRef: row.transcriptRef,
  });
  const scoring = compact({
    productFit: row.productFit,
    replicability: row.replicability,
    creativeStrength: row.creativeStrength,
    rawEngagementScore: row.rawEngagementScore,
    engagementScore: row.engagementScore,
    replicationScore: row.replicationScore,
  });

  const source = compact({
    instanceId: row.instanceId,
    ownerId: row.ownerId,
    templateId: "@opengroow/engagement",
    sourceId: declaration.type,
    label: declaration.label,
    family: declaration.family,
    status: row.enrichmentStatus === undefined ? "ready" : STATUS_BY_ENRICHMENT[row.enrichmentStatus],
    origin: row.postUrl,
    capturedAt: row.capturedAt,
    createdAt: row.createdAt,
    marketing,
    analysis,
    scoring: Object.keys(scoring).length > 0 ? scoring : undefined,
    missionId: row.missionId,
    runId: row.runId,
    rawData: row.rawData,
    enrichedAt: row.enrichedAt,
    enrichmentAnalyzer: row.enrichmentAnalyzer,
    creativeFamilyId: row.creativeFamilyId,
    excluded: row.excluded,
    selectedAt: row.selectedAt,
    producedAt: row.producedAt,
    publishedAt: row.publishedAt,
    productionMissionId: row.productionMissionId,
    delegateMissionId: row.delegateMissionId,
  }) as SourceInsert;
  return await ctx.db.insert("sources", source);
}
