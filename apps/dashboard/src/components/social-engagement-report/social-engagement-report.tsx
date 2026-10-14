/**
 * The Engagement Report shown on a social-engagement Mission's review page:
 * the Run's stats row, its metadata, and one row per post it observed.
 *
 * Entry point of this folder — parses the raw report.json string, hands it to
 * `normalizeReport`, and renders the result. The pieces live alongside:
 * `post-row` (a single observed post), `report-badges` (the shared badges and
 * stat cards), `report-schema` (the schema and its type guard).
 */
"use client";

import { normalizeReport } from "./normalize-report";
import { PostRow } from "./post-row";
import { SummaryCard } from "./report-badges";
import type { SocialEngagementReportData } from "./report-schema";
export { isSocialEngagementReport } from "./report-schema";

// ---------------------------------------------------------------------------

export type SocialEngagementReportProps = {
  /** Raw JSON string of report.json */
  content: string;
  /** Supplementary fields captured from the RunResult */
  additionalDetails?: Record<string, unknown>;
};

function SchemaDeviationsWarning({ deviations }: { deviations: string[] }) {
  if (deviations.length === 0) return null;
  return (
    <details className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
      <summary className="cursor-pointer text-[0.8rem] font-bold uppercase tracking-[0.14em] text-amber-800">
        This report doesn&apos;t match the documented schema ({deviations.length})
      </summary>
      <ul className="m-0 mt-3 grid gap-1 pl-4 text-[0.8rem] text-amber-900">
        {deviations.map((d, i) => (
          <li key={i} className="list-disc">{d}</li>
        ))}
      </ul>
    </details>
  );
}

function AdditionalDetails({ details }: { details: Record<string, unknown> | undefined }) {
  if (details === undefined || Object.keys(details).length === 0) return null;

  return (
    <details className="rounded-2xl border border-[rgba(0,38,27,0.08)] bg-[#f8f9f7] px-4 py-3">
      <summary className="cursor-pointer text-[0.8rem] font-bold uppercase tracking-[0.14em] text-[var(--dashboard-ink-soft)]">
        Additional details
      </summary>
      <pre className="m-0 mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-white p-3 text-[0.78rem] leading-relaxed text-[var(--dashboard-ink-muted)]">
        {JSON.stringify(details, null, 2)}
      </pre>
    </details>
  );
}

export function SocialEngagementReport({
  content,
  additionalDetails,
}: SocialEngagementReportProps) {
  const report = (() => {
    try {
      return JSON.parse(content) as SocialEngagementReportData;
    } catch {
      return null;
    }
  })();

  if (!report) {
    return (
      <p className="text-[0.88rem] text-red-700">
        Failed to parse social-engagement report.
      </p>
    );
  }

  const { stats, posts, totalObserved, deviations: schemaDeviations } = normalizeReport(report);

  return (
    <div className="grid gap-6">
      <SchemaDeviationsWarning deviations={schemaDeviations} />
      {/* Stats row */}
      <div className="flex flex-wrap gap-3">
        <SummaryCard label="Observed" count={totalObserved} variant="neutral" />
        {stats.liked !== undefined && (
          <SummaryCard label="Liked" count={stats.liked} variant="neutral" />
        )}
        {stats.commented !== undefined && (
          <SummaryCard label="Commented" count={stats.commented} variant="neutral" />
        )}
        {stats.liked_and_commented !== undefined && (
          <SummaryCard label="Liked & Commented" count={stats.liked_and_commented} variant="success" />
        )}
        {stats.followed !== undefined && (
          <SummaryCard label="Followed" count={stats.followed} variant="neutral" />
        )}
        {stats.skipped !== undefined && (
          <SummaryCard label="Skipped" count={stats.skipped} variant="neutral" />
        )}
        {stats.failed !== undefined && (
          <SummaryCard label="Failed" count={stats.failed} variant="danger" />
        )}
      </div>

      {/* Run metadata */}
      {(report.startedAt || report.completedAt) && (
        <div className="flex flex-wrap gap-4 text-[0.8rem] text-[var(--dashboard-ink-muted)]">
          {report.startedAt && (
            <span>Started: {new Date(report.startedAt).toLocaleString()}</span>
          )}
          {report.completedAt && (
            <span>Completed: {new Date(report.completedAt).toLocaleString()}</span>
          )}
        </div>
      )}

      <AdditionalDetails details={additionalDetails} />

      {/* Posts */}
      {posts.length > 0 && (
        <div className="grid gap-3">
          <h3 className="text-[0.8rem] font-bold uppercase tracking-[0.14em] text-[var(--dashboard-ink-soft)]">
            Posts ({posts.length})
          </h3>
          {posts.map((post, idx) => (
            <PostRow key={post.index ?? idx} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
