import type {
  PublisherAdapter,
  PublisherChannel,
  PublisherConnection,
  PublisherResult,
} from "./adapter.js";

const NOT_IMPLEMENTED = { ok: false, error: "Not implemented yet" } as const;

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

  // V1 publishes `image` Publishables. Media is fetched by Postiz from its
  // reference (upload-from-url): OpenGroow never stores it (ADR-010).
  async publish(conn, request) {
    const publishable = request.publishable as { kind?: string; imageUrl?: string; caption?: string };
    if (publishable.kind !== "image" || typeof publishable.imageUrl !== "string") {
      return { ok: false, error: `Publishing a "${String(publishable.kind)}" is not supported yet` };
    }
    const channels = await postizAdapter.listChannels(conn);
    if (!channels.ok) return channels;
    const channel = channels.channels.find((c) => c.id === request.channelId);
    if (!channel) return { ok: false, error: `Postiz channel ${request.channelId} no longer exists` };

    const upload = await call(conn, "upload-from-url", { url: publishable.imageUrl });
    if (!upload.ok) return upload;
    const media = upload.body as { id?: unknown; path?: unknown } | null;
    if (typeof media?.id !== "string" || typeof media.path !== "string") {
      return { ok: false, error: "Postiz returned an unexpected upload response" };
    }

    const scheduled = request.publishAt !== undefined;
    const posted = await call(conn, "posts", {
      type: scheduled ? "schedule" : "now",
      date: new Date(request.publishAt ?? Date.now()).toISOString(),
      shortLink: false,
      tags: [],
      posts: [
        {
          integration: { id: channel.id },
          value: [{ content: publishable.caption ?? "", image: [{ id: media.id, path: media.path }] }],
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
  async getStatus() {
    return NOT_IMPLEMENTED;
  },
};

export function adapterFor(id: "postiz"): PublisherAdapter {
  return postizAdapter;
}
