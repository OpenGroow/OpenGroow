import type {
  PublisherAdapter,
  PublisherChannel,
  PublisherConnection,
  PublisherResult,
} from "./adapter.js";

function endpoint(conn: PublisherConnection, path: string): string {
  return `${conn.url.replace(/\/+$/, "")}/public/v1/${path}`;
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
    const channels = await postizAdapter.listChannels(conn);
    if (!channels.ok) return channels;
    const channel = channels.channels.find((c) => c.id === request.channelId);
    if (!channel) return { ok: false, error: `Postiz channel ${request.channelId} no longer exists` };

    // Sequential: the order of the uploads is the order of the slides.
    const uploaded: Array<{ id: string; path: string }> = [];
    for (const url of media.urls) {
      const upload = await call(conn, "upload-from-url", { url });
      if (!upload.ok) return upload;
      const item = upload.body as { id?: unknown; path?: unknown } | null;
      if (typeof item?.id !== "string" || typeof item.path !== "string") {
        return { ok: false, error: "Postiz returned an unexpected upload response" };
      }
      uploaded.push({ id: item.id, path: item.path });
    }
    const publishable = request.publishable as { caption?: string };

    const scheduled = request.publishAt !== undefined;
    const posted = await call(conn, "posts", {
      type: scheduled ? "schedule" : "now",
      date: new Date(request.publishAt ?? Date.now()).toISOString(),
      shortLink: false,
      tags: [],
      posts: [
        {
          integration: { id: channel.id },
          value: [{ content: publishable.caption ?? "", image: uploaded }],
          settings: { __type: channel.service, ...(request.settings ?? {}) },
        },
      ],
    });
    if (!posted.ok) return posted;
    const first = Array.isArray(posted.body) ? (posted.body[0] as { postId?: unknown } | undefined) : undefined;
    if (typeof first?.postId !== "string") {
      return { ok: false, error: "Postiz returned an unexpected response when creating the post" };
    }
    return { ok: true, outcome: { externalId: first.postId, status: scheduled ? "scheduled" : "published" } };
  },
  // Postiz's public API has no per-post read: list the posts around the
  // scheduled date and find ours. QUEUE = still scheduled.
  async getStatus(conn, externalId, around = Date.now()) {
    const DAY = 86_400_000;
    const query = new URLSearchParams({
      startDate: new Date(around - DAY).toISOString(),
      endDate: new Date(Math.max(around, Date.now()) + DAY).toISOString(),
    });
    const res = await call(conn, `posts?${query.toString()}`);
    if (!res.ok) return res;
    const posts = (res.body as { posts?: unknown } | null)?.posts;
    if (!Array.isArray(posts)) return { ok: false, error: "Postiz returned an unexpected post list" };
    const post = (posts as Array<Record<string, unknown>>).find((p) => p?.id === externalId);
    if (!post) return { ok: true, post: { status: "failed", error: "The post no longer exists in Postiz" } };
    const url = typeof post.releaseURL === "string" && post.releaseURL !== "" ? post.releaseURL : undefined;
    switch (post.state) {
      case "PUBLISHED":
        return { ok: true, post: { status: "published", ...(url ? { externalUrl: url } : {}) } };
      case "ERROR":
        return { ok: true, post: { status: "failed", error: "Postiz could not publish the post" } };
      case "QUEUE":
        return { ok: true, post: { status: "scheduled" } };
      default:
        return { ok: true, post: { status: "pending" } };
    }
  },
};

export function adapterFor(id: "postiz"): PublisherAdapter {
  return postizAdapter;
}
