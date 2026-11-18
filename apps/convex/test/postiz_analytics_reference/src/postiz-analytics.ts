import manifest from "../manifest.json";
import metricsData from "../data/metrics.json";
import type { AnalyticsAdapter, AnalyticsConnection, AnalyticsResult, ReadRequest } from "@opengroow/publisher-sdk";

// The Postiz Analytics Adapter (ADR-078). The statistics of one post come from
// `GET <host>/api/public/v1/analytics/post/<postId>?date=<days>`: an array of
// { label, percentageChange, data: [{ total: "<string>", date }] }. The labels
// depend on the platform (Instagram: Views, Reach, Saves, Likes, Comments,
// Shares; TikTok: Views, Likes, Comments, Shares) and a missing one is normal.
// An empty array does not say whether the post is unknown or has no data yet:
// the posts listing tells them apart.

const DAY = 86_400_000;
const LABELS: Record<string, string> = metricsData.labels;
const LOOKBACK = manifest.options[0]!;

/**
 * The id the statistics route expects, from the id the Publisher stored on the Publication. The
 * dashboard calls it with the Postiz post id, which is what the Publisher stores (`findPost`).
 * Whether the PUBLIC route takes the same id is still to be confirmed on a real instance: if it
 * wants another id, this is the one place to change.
 */
function postIdOf(request: ReadRequest): string | undefined {
  return request.externalId;
}

function endpoint(conn: AnalyticsConnection, path: string): string {
  return `${conn.url.replace(/\/+$/, "")}/api/public/v1/${path}`;
}

function lookbackDays(conn: AnalyticsConnection): number {
  const value = conn.options?.lookbackDays;
  const days = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : LOOKBACK.default;
  return Math.min(LOOKBACK.max, Math.max(LOOKBACK.min, days));
}

async function get(conn: AnalyticsConnection, path: string): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(endpoint(conn, path), { headers: { Authorization: conn.apiKey, Accept: "application/json" } });
  } catch (error) {
    return { ok: false, error: `Could not reach Postiz: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!response.ok) {
    const hint = response.status === 401 || response.status === 403 ? " (check the API key)" : "";
    return { ok: false, error: `Postiz responded ${response.status}${hint}` };
  }
  try {
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, error: "Postiz returned an unreadable response (check the URL)" };
  }
}

/** The value of one label: the total of its latest day, parsed from the string Postiz sends. */
function currentValue(entry: { data?: unknown }): number | undefined {
  if (!Array.isArray(entry.data)) return undefined;
  let latest: { date: string; total: number } | undefined;
  for (const point of entry.data as Array<{ total?: unknown; date?: unknown }>) {
    const total = typeof point?.total === "string" || typeof point?.total === "number" ? Number(point.total) : NaN;
    const date = typeof point?.date === "string" ? point.date : "";
    if (!Number.isFinite(total) || total < 0) continue;
    if (!latest || date >= latest.date) latest = { date, total };
  }
  return latest?.total;
}

/** Whether the posts listing around the publication holds the post: it exists, it just has nothing to report yet. */
async function isListed(conn: AnalyticsConnection, postId: string, publishedAt: number) {
  const query = new URLSearchParams({
    startDate: new Date(publishedAt - 7 * DAY).toISOString(),
    endDate: new Date(publishedAt + 7 * DAY).toISOString(),
  });
  const res = await get(conn, `posts?${query.toString()}`);
  if (!res.ok) return res;
  const posts = (res.body as { posts?: unknown } | null)?.posts;
  if (!Array.isArray(posts)) return { ok: false as const, error: "Postiz returned an unexpected post list" };
  return { ok: true as const, listed: posts.some((p) => (p as { id?: unknown } | null)?.id === postId) };
}

export const postizAnalytics: AnalyticsAdapter = {
  id: manifest.id,
  name: manifest.name,
  contractVersion: manifest.contractVersion,
  needs: "externalId",
  earliestDelayMs: manifest.earliestDelayMs,

  async read(conn, request): Promise<AnalyticsResult> {
    const postId = postIdOf(request);
    if (!postId) return { ok: false, error: "The Publication has no Postiz post id to read" };
    const res = await get(conn, `analytics/post/${encodeURIComponent(postId)}?date=${lookbackDays(conn)}`);
    if (!res.ok) return res;
    if (!Array.isArray(res.body)) return { ok: false, error: "Postiz returned an unexpected analytics answer" };

    const metrics: Record<string, number> = {};
    for (const entry of res.body as Array<{ label?: unknown; data?: unknown }>) {
      const metric = typeof entry?.label === "string" ? LABELS[entry.label] : undefined; // unknown labels are ignored
      const value = metric ? currentValue(entry) : undefined;
      if (metric && value !== undefined) metrics[metric] = value;
    }
    if (Object.keys(metrics).length > 0) return { ok: true, reading: { status: "taken", metrics } };

    if (res.body.length > 0) return { ok: true, reading: { status: "no_data" } };
    // `[]` is also what an unknown id answers: ask the listing.
    const listed = await isListed(conn, postId, request.publishedAt);
    if (!listed.ok) return listed;
    return listed.listed
      ? { ok: true, reading: { status: "no_data" } }
      : { ok: true, reading: { status: "unavailable", reason: "Postiz does not know this post (deleted, or on another instance)" } };
  },
};
