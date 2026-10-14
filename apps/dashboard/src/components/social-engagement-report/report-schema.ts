/**
 * The report.json shape a social-engagement Run writes, as documented in the
 * template's AGENTS.md `## report.json schema`.
 *
 * Nothing enforces the Agent actually writes this shape — `normalizeReport`
 * folds the known deviations back into it before anything renders.
 */
export type PostSummary = {
  contentType?: string;
  caption?: string;
  hashtags?: string[];
  accountHandle?: string;
};

export type CommentAction = {
  commentsLiked?: number[];
  commentPosted?: string;
  commentPostReason?: string;
};

export type AgentEvaluation = {
  relevanceScore?: number;
  relevanceReason?: string;
  decision?: string;
  followed?: boolean;
  commentAction?: CommentAction;
};

// Pre-commentAction-schema reports (commit 4d3233c) nested the comment
// action's fields inside a flat top-level `actions` array instead of
// `agentEvaluation.commentAction` — kept for backward compatibility with
// already-persisted report.json files in that older shape.
export type LegacyPostAction = {
  type?: string;
  result?: string;
  commentDraft?: string;
  commentPosted?: string;
  screenshotPath?: string;
};

/**
 * Current reports keep the post's executed action flags in an object. Older
 * reports used `actions` as an array of action records, which is still read
 * for backwards-compatible comment rendering.
 */
export type PostActionsSummary = {
  liked?: boolean;
  followed?: boolean;
  commented?: boolean;
  commentText?: string | null;
};

/** Outcome of the local VLM call that produced `ReportPost.visualDescription`. */
export type VisualDescriptionStatus = {
  ok?: boolean;
  reason?: string;
  latencyMs?: number;
};

/** What the classifier answered for the post; added by the CLI, never by the Agent. */
export type ClassifierEvaluation = {
  status?: "available" | "unavailable";
  shouldLikeScore?: number;
  shouldCommentScore?: number;
  failureReason?: string;
};

/**
 * One attempt to re-resolve a drifted app-profile resource-id while this post
 * was handled (anchor repair); added by the CLI, never by the Agent.
 */
export type AnchorRepair = {
  /** The profile field, e.g. "postLikeCountResourceId". */
  field?: string;
  from?: string | null;
  to?: string | null;
  confidence?: number | null;
  /** "persisted" when verified and written to the profile; anything else means nothing changed. */
  outcome?: string;
};

export type ReportPost = {
  index?: number;
  observedAt?: string;
  screenshotPath?: string;
  postSummary?: PostSummary;
  /** Text a local VLM read off the post's media (embedded text + scene); added by the CLI, never by the Agent. */
  visualDescription?: string | null;
  visualDescriptionStatus?: VisualDescriptionStatus | null;
  classifierEvaluation?: ClassifierEvaluation | null;
  anchorRepairs?: AnchorRepair[];
  agentEvaluation?: AgentEvaluation;
  actions?: LegacyPostAction[] | PostActionsSummary;
};

export type ReportStats = {
  liked?: number;
  commented?: number;
  liked_and_commented?: number;
  skipped?: number;
  failed?: number;
  followed?: number;
};

export type SocialEngagementReportData = {
  runId?: string;
  missionId?: string;
  startedAt?: string;
  completedAt?: string;
  totalObserved?: number;
  totalTargeted?: number;
  // `stats` is the current field name (`summary` before the report.json
  // schema migration) — kept here for already-persisted reports in that
  // older shape.
  stats?: ReportStats;
  summary?: ReportStats;
  posts?: ReportPost[];
};

/**
 * Returns true if the parsed JSON object looks like a social-engagement report.
 */
export function isSocialEngagementReport(data: unknown): data is SocialEngagementReportData {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  // A social-engagement report has at least a posts array, or stats/summary
  // (the field was renamed `summary` -> `stats`; accept either).
  return (
    Array.isArray(d.posts) ||
    (d.stats !== undefined && typeof d.stats === "object") ||
    (d.summary !== undefined && typeof d.summary === "object")
  );
}
