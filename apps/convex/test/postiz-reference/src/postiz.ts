import capabilitiesData from "../data/capabilities.json";
import channelOptionsData from "../data/channel-options.json";
import manifestData from "../manifest.json";
import { postizSettings } from "./settings";
import type {
  CapabilitiesData,
  ChannelOptionsData,
  PublisherPlugin,
  PostStatus,
  UploadedMedia,
  PublisherChannel,
  PublisherConnection,
  PublisherResult,
} from "@opengroow/publisher-sdk";

function endpoint(conn: PublisherConnection, path: string): string {
  return `${conn.url.replace(/\/+$/, "")}/api/public/v1/${path}`;
}

/** Postiz explains a rejection in its body (`message`, validation errors): keep a short excerpt. */
async function errorDetail(response: Response): Promise<string> {
  try {
    const raw = (await response.text()).trim();
    if (!raw) return "";
    let text = raw;
    try {
      const body = JSON.parse(raw) as { message?: unknown };
      if (body && typeof body === "object") {
        text = typeof body.message === "string" ? body.message : Array.isArray(body.message) ? body.message.join("; ") : raw;
      }
    } catch {
      // Not JSON: keep the raw text.
    }
    return `: ${text.replace(/\s+/g, " ").slice(0, 300)}`;
  } catch {
    return "";
  }
}

async function call(
  conn: PublisherConnection,
  path: string,
  json?: unknown,
  /** A multipart body (the content-type, with its boundary, is set by fetch). */
  form?: FormData,
): Promise<PublisherResult<{ body: unknown }>> {
  let response: Response;
  try {
    response = await fetch(endpoint(conn, path), {
      ...(form !== undefined
        ? { method: "POST", body: form }
        : json !== undefined
          ? { method: "POST", body: JSON.stringify(json) }
          : {}),
      headers: {
        Authorization: conn.apiKey,
        Accept: "application/json",
        ...(json !== undefined && form === undefined ? { "Content-Type": "application/json" } : {}),
      },
    });
  } catch (error) {
    return { ok: false, uncertain: true, error: `Could not reach Postiz: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!response.ok) {
    const hint = response.status === 401 || response.status === 403 ? " (check the API key)" : "";
    // A 4xx proves Postiz rejected the request; a 5xx (or 408) does not prove it did not act.
    const rejected = response.status >= 400 && response.status < 500 && response.status !== 408;
    const detail = await errorDetail(response);
    return { ok: false, ...(rejected ? {} : { uncertain: true }), error: `Postiz responded ${response.status}${hint}${detail}` };
  }
  try {
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, uncertain: true, error: "Postiz returned an unreadable response (check the URL)" };
  }
}

const FETCHABLE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp4"];
const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
};

/**
 * Whether Postiz will accept to fetch this URL itself (`upload-from-url`): a
 * public HTTPS URL ending with a supported extension. Postiz refuses anything
 * else (SSRF protection), e.g. a local MCP on `http://localhost` or a URL such as
 * `/videos/<id>/final`. Checked on the literal host only (no DNS lookup).
 */
export function postizCanFetch(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (/^(0|10|127)\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) return false;
  if (host.includes(":")) return false; // IPv6 literal: loopback, link-local... not worth parsing
  if (!host.includes(".")) return false; // single-label name (a Docker service, an intranet host)
  const path = url.pathname.toLowerCase();
  return FETCHABLE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/**
 * Downloads a media Postiz cannot fetch itself and sends its bytes to Postiz
 * (`upload`, multipart). Local development mostly: a production MCP serves
 * public HTTPS URLs, which Postiz fetches (ADR-010). The file lives in memory
 * for the duration of the call.
 */
async function uploadBytes(conn: PublisherConnection, url: string): Promise<PublisherResult<{ body: unknown }>> {
  let source: Response;
  try {
    source = await fetch(url);
  } catch (error) {
    return { ok: false, error: `Could not download the media ${url}: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!source.ok) return { ok: false, error: `Could not download the media ${url}: it responded ${source.status}` };
  const type = (source.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  let name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "media");
  if (!FETCHABLE_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext))) {
    const ext = EXTENSION_BY_TYPE[type];
    if (!ext) return { ok: false, error: `Could not send the media ${url} to Postiz: unsupported type "${type || "unknown"}"` };
    name = `${name}${ext}`;
  }
  const form = new FormData();
  form.append("file", new Blob([await source.arrayBuffer()], { type: type || undefined }), name);
  return call(conn, "upload", undefined, form);
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

// manifest.json is the single source of the plugin's identity. This file only
// reads it: the core validates the manifest and the two data files when the
// package is installed, and checks the plugin against them when it loads it
// (ADR-072), so the plugin needs nothing from the SDK at run time, only types.
export const postizManifest = manifestData as { id: string; name: string; contractVersion: number; postUrl?: string; icon?: string };

export const postizPlugin: PublisherPlugin = {
  id: postizManifest.id,
  name: postizManifest.name,
  contractVersion: postizManifest.contractVersion,
  postUrl: postizManifest.postUrl,
  capabilities: capabilitiesData as CapabilitiesData,
  channelOptions: channelOptionsData as ChannelOptionsData,

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
  // safe in a Convex action (docs/domain/publishing.md, "Large videos"). The
  // exception is a URL Postiz refuses to fetch (local MCP, no extension): its
  // bytes are then downloaded and sent (`uploadBytes`).
  async publish(conn, request) {
    const media = mediaReferences(request.publishable);
    if (!media.ok) return media;
    // The channel's service comes from the mapping (cached when the target was
    // mapped), so publishing does not re-list every channel. Older mappings
    // without it fall back to one listing.
    let service = request.channelService;
    if (service === undefined) {
      const channels = await postizPlugin.listChannels(conn);
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
      const res = postizCanFetch(url) ? await call(conn, "upload-from-url", { url }) : await uploadBytes(conn, url);
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
