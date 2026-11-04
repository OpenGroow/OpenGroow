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
): Promise<PublisherResult<{ body: unknown }>> {
  let response: Response;
  try {
    response = await fetch(endpoint(conn, path), {
      headers: { Authorization: conn.apiKey, Accept: "application/json" },
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

  // Publishing and status follow-up land with the Publication slice.
  async publish() {
    return NOT_IMPLEMENTED;
  },
  async getStatus() {
    return NOT_IMPLEMENTED;
  },
};

export function adapterFor(id: "postiz"): PublisherAdapter {
  return postizAdapter;
}
