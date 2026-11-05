import { postizSettings } from "./postiz_settings.js";
import type {
  PostStatus,
  PublisherAdapter,
  UploadedMedia,
  PublisherChannel,
  PublisherConnection,
  PublisherResult,
} from "./adapter.js";

function endpoint(conn: PublisherConnection, path: string): string {
  return `${conn.url.replace(/\/+$/, "")}/api/public/v1/${path}`;
}

async function call(
  conn: PublisherConnection,
  path: string,
  json?: unknown,
): Promise<PublisherResult<{ body: unknown }>> {
  let response: Response;
  try {
    response = await fetch(endpoint(conn, path), {
      ...(json !== undefined ? { method: "POST", body: JSON.stringify(json) } : {}),
      headers: {
        Authorization: conn.apiKey,
        Accept: "application/json",
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      },
    });
  } catch (error) {
    return { ok: false, uncertain: true, error: `Could not reach Postiz: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!response.ok) {
    const hint = response.status === 401 || response.status === 403 ? " (check the API key)" : "";
    // A 4xx proves Postiz rejected the request; a 5xx (or 408) does not prove it did not act.
    const rejected = response.status >= 400 && response.status < 500 && response.status !== 408;
    return { ok: false, ...(rejected ? {} : { uncertain: true }), error: `Postiz responded ${response.status}${hint}` };
  }
  try {
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, uncertain: true, error: "Postiz returned an unreadable response (check the URL)" };
  }
}

/** The media a Publishable sends, in posting order. `image` and `video` have one, `carousel` its slides. */
function mediaReferences(publishable: Record<string, unknown>): PublisherResult<{ urls: string[] }> {
  const { kind } = publishable;
  if (kind === "image" && typeof publishable.imageUrl === "string") return { ok: true, urls: [publishable.imageUrl] };
  if (kind === "video" && typeof publishable.videoUrl === "string") return { ok: true, urls: [publishable.videoUrl] };
  if (kind === "carousel" && Array.isArray(publishable.slideUrls) && publishable.slideUrls.length > 0) {
    return { ok: true, urls: publishable.slideUrls.filter((u): u is string => typeof u === "string") };
  }
  return { ok: false, error: `Publishing a "${String(kind)}" is not supported (missing media reference)` };
}

export const postizAdapter: PublisherAdapter = {
  async testConnection(conn) {
    const res = await call(conn, "is-connected");
    if (!res.ok) return res;
    const connected = (res.body as { connected?: unknown } | null)?.connected;
    return connected === true ? { ok: true } : { ok: false, error: "Postiz did not confirm the connection" };
  },

  async listChannels(conn) {
    const res = await call(conn, "integrations");
    if (!res.ok) return res;
    if (!Array.isArray(res.body)) return { ok: false, error: "Postiz returned an unexpected channel list" };
    const channels: PublisherChannel[] = [];
    for (const raw of res.body as Array<Record<string, unknown>>) {
      if (typeof raw?.id !== "string") continue;
      channels.push({
        id: raw.id,
        name: typeof raw.name === "string" ? raw.name : raw.id,
        service: typeof raw.identifier === "string" ? raw.identifier : "unknown",
        ...(typeof raw.picture === "string" ? { picture: raw.picture } : {}),
        ...(typeof raw.profile === "string" && raw.profile ? { profile: raw.profile } : {}),
        ...(typeof raw.disabled === "boolean" ? { disabled: raw.disabled } : {}),
      });
    }
    return { ok: true, channels };
  },

  // Media is fetched by Postiz from its reference (upload-from-url): OpenGroow
  // never downloads nor stores it (ADR-010), which is what makes large videos
  // safe in a Convex action (docs/domain/publishing.md, "Large videos").
  async publish(conn, request) {
    const media = mediaReferences(request.publishable);
    if (!media.ok) return media;
    // The channel's service comes from the mapping (cached when the target was
    // mapped), so publishing does not re-list every channel. Older mappings
    // without it fall back to one listing.
    let service = request.channelService;
    if (service === undefined) {
      const channels = await postizAdapter.listChannels(conn);
      if (!channels.ok) return channels;
      const channel = channels.channels.find((c) => c.id === request.channelId);
      if (!channel) return { ok: false, error: `Postiz channel ${request.channelId} no longer exists` };
      service = channel.service;
    }

    // Sequential: the order of the uploads is the order of the slides. An upload
    // an earlier attempt already made (same source URL) is reused.
    const uploadedMedia: UploadedMedia[] = [];
    async function upload(url: string): Promise<PublisherResult<{ item: UploadedMedia }>> {
      const known = request.media?.find((m) => m.url === url);
      if (known) {
        uploadedMedia.push(known);
        return { ok: true, item: known };
      }
      const res = await call(conn, "upload-from-url", { url });
      if (!res.ok) return { ok: false, error: res.error };
      const body = res.body as { id?: unknown; path?: unknown } | null;
      if (typeof body?.id !== "string" || typeof body.path !== "string") {
        return { ok: false, error: "Postiz returned an unexpected upload response" };
      }
      const item = { url, id: body.id, path: body.path };
      uploadedMedia.push(item);
      return { ok: true, item };
    }
    const uploaded: Array<{ id: string; path: string; alt?: string }> = [];
    for (const url of media.urls) {
      const res = await upload(url);
      if (!res.ok) return { ok: false, error: res.error };
      uploaded.push({ id: res.item.id, path: res.item.path });
    }
    // Image alt text (Instagram, Bluesky, Mastodon...; other providers ignore it). Videos have none.
    const { kind, altText } = request.publishable;
    if (kind !== "video" && typeof altText === "string" && altText) {
      for (const item of uploaded) item.alt = altText;
    }
    // YouTube is the only provider whose thumbnail Postiz takes as an image (the
    // cover is uploaded like any media). Elsewhere `coverUrl` is ignored.
    let thumbnail: { id: string; path: string } | undefined;
    if (service === "youtube" && typeof request.publishable.coverUrl === "string") {
      const res = await upload(request.publishable.coverUrl);
      if (!res.ok) return { ok: false, error: res.error };
      thumbnail = { id: res.item.id, path: res.item.path };
    }
    const caption = typeof request.publishable.caption === "string" ? request.publishable.caption : "";

    const settings = postizSettings(service, request.publishable, request.settings, thumbnail);
    if (!settings.ok) return settings;

    const scheduled = request.publishAt !== undefined;
    if (request.beforePost && !(await request.beforePost(uploadedMedia))) {
      return { ok: false, error: "This Publication is already being sent" };
    }
    const posted = await call(conn, "posts", {
      type: scheduled ? "schedule" : "now",
      date: new Date(request.publishAt ?? Date.now()).toISOString(),
      shortLink: false,
      tags: [],
      posts: [
        {
          integration: { id: request.channelId },
          value: [{ content: caption, image: uploaded }],
          settings: settings.settings,
        },
      ],
    });
    if (!posted.ok) return posted;
    const first = Array.isArray(posted.body) ? (posted.body[0] as { postId?: unknown } | undefined) : undefined;
    if (typeof first?.postId !== "string") {
      return { ok: false, uncertain: true, error: "Postiz returned an unexpected response when creating the post" };
    }
    return { ok: true, outcome: { externalId: first.postId, status: scheduled ? "scheduled" : "published" } };
  },
  async findPost(conn, query) {
    const MARGIN = 120_000;
    const now = Date.now();
    const res = await listPosts(conn, Math.min(query.attemptStartedAt, query.attemptDate), Math.max(query.attemptDate, now));
    if (!res.ok) return res;
    const wanted = normalizeContent(query.caption);
    const inWindow = (value: unknown) => {
      const at = typeof value === "string" ? Date.parse(value) : NaN;
      return Number.isFinite(at) && at >= query.attemptStartedAt - MARGIN && at <= now + MARGIN;
    };
    const asked = (value: unknown) => {
      const at = typeof value === "string" ? Date.parse(value) : NaN;
      return Number.isFinite(at) && Math.abs(at - query.attemptDate) <= MARGIN;
    };
    for (const post of res.posts) {
      if (typeof post.id !== "string") continue;
      const integration = (post.integration as { id?: unknown } | null | undefined)?.id;
      if (integration !== query.channelId) continue;
      if (normalizeContent(post.content) !== wanted) continue;
      if (!(inWindow(post.createdAt) || inWindow(post.publishDate) || asked(post.publishDate))) continue;
      const status = postStatusOf(post);
      if (status.status === "failed") continue; // Postiz itself errored on it: it never went out.
      return { ok: true, post: { externalId: post.id, ...status } };
    }
    return { ok: true, post: null };
  },

  // Postiz's public API has no per-post read: list the posts around the
  // scheduled date and find ours. QUEUE = still scheduled.
  async getStatus(conn, externalId, around = Date.now()) {
    const DAY = 86_400_000;
    const res = await listPosts(conn, around - DAY, Math.max(around, Date.now()) + DAY);
    if (!res.ok) return res;
    const post = res.posts.find((p) => p?.id === externalId);
    if (!post) return { ok: true, post: { status: "failed", error: "The post no longer exists in Postiz" } };
    return { ok: true, post: postStatusOf(post) };
  },
};

/** Lists the Postiz posts between two dates (epoch ms). */
async function listPosts(
  conn: PublisherConnection,
  from: number,
  to: number,
): Promise<PublisherResult<{ posts: Array<Record<string, unknown>> }>> {
  const DAY = 86_400_000;
  const query = new URLSearchParams({
    startDate: new Date(from - DAY).toISOString(),
    endDate: new Date(to + DAY).toISOString(),
  });
  const res = await call(conn, `posts?${query.toString()}`);
  if (!res.ok) return res;
  const posts = (res.body as { posts?: unknown } | null)?.posts;
  if (!Array.isArray(posts)) return { ok: false, error: "Postiz returned an unexpected post list" };
  return { ok: true, posts: posts as Array<Record<string, unknown>> };
}

function postStatusOf(post: Record<string, unknown>): PostStatus {
  const url = typeof post.releaseURL === "string" && post.releaseURL !== "" ? post.releaseURL : undefined;
  switch (post.state) {
    case "PUBLISHED":
      return { status: "published", ...(url ? { externalUrl: url } : {}) };
    case "ERROR":
      return { status: "failed", error: "Postiz could not publish the post" };
    case "QUEUE":
      return { status: "scheduled" };
    default:
      return { status: "pending" };
  }
}

/** Postiz stores the caption as HTML: compare text only, whitespace-insensitive. */
function normalizeContent(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function adapterFor(id: "postiz"): PublisherAdapter {
  return postizAdapter;
}
