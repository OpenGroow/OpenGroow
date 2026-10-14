
/**
 * The one place that tolerates a report.json deviating from its documented
 * schema.
 *
 * Reshaping happens here and nowhere else, so every renderer downstream reads
 * the canonical nested shape only — and a newly tolerated deviation cannot be
 * added without also being surfaced to the user, since the same pass returns
 * the list the warning banner renders.
 */

import type {
  AgentEvaluation,
  PostSummary,
  ReportPost,
  ReportStats,
  SocialEngagementReportData,
} from "./report-schema";

/**
 * Reshapes a parsed report into the canonical schema and reports what had to
 * be reshaped, in one pass.
 *
 * The Agent writes report.json in natural language against `AGENTS.md`'s
 * `## report.json schema`, and nothing enforces it actually matches — a run
 * reproduced live (Mission "engage #150" retry, 2026-08-18) wrote
 * accountHandle/caption/decision/relevanceScore/relevanceReason/followed/
 * commentAction flat on the post instead of nested, and reports written
 * before the schema migration carry root `summary` instead of `stats`.
 *
 * Tolerating those shapes keeps a mismatched report rendering; doing it here
 * and nowhere else keeps the renderers reading the canonical shape only, and
 * means a newly tolerated deviation cannot be added without also being
 * surfaced (`deviations` feeds `SchemaDeviationsWarning`) — otherwise
 * silently absorbing every past deviation forever lets new ones go unnoticed
 * instead of feeding back into `AGENTS.md`.
 */
export function normalizeReport(report: SocialEngagementReportData): {
  stats: ReportStats;
  posts: ReportPost[];
  totalObserved: number;
  deviations: string[];
} {
  const deviations: string[] = [];

  if (report.summary !== undefined && report.stats === undefined) {
    deviations.push("Root `stats` is missing — using legacy `summary` field instead.");
  }

  const posts = (report.posts ?? []).map((post, i) => {
    const flat = post as PostSummary & AgentEvaluation;
    const hasFlatSummary = post.postSummary === undefined && flat.accountHandle !== undefined;
    const hasFlatEvaluation = post.agentEvaluation === undefined && flat.decision !== undefined;
    if (hasFlatSummary) {
      deviations.push(`Post ${i}: fields are flat on the post instead of nested under \`postSummary\`.`);
    }
    if (hasFlatEvaluation) {
      deviations.push(`Post ${i}: fields are flat on the post instead of nested under \`agentEvaluation\`.`);
    }
    return {
      ...post,
      postSummary: post.postSummary ?? {
        contentType: flat.contentType,
        caption: flat.caption,
        hashtags: flat.hashtags,
        accountHandle: flat.accountHandle,
      },
      agentEvaluation: post.agentEvaluation ?? {
        relevanceScore: flat.relevanceScore,
        relevanceReason: flat.relevanceReason,
        decision: flat.decision,
        followed: flat.followed,
        commentAction: flat.commentAction,
      },
    };
  });

  return {
    stats: report.stats ?? report.summary ?? {},
    posts,
    totalObserved: report.totalObserved ?? posts.length,
    deviations,
  };
}
