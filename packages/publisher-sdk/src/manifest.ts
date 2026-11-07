// The manifest of a Publisher package (ADR-072): the data the core stores when
// a package is installed, next to its code bundle. It carries everything
// queries, mutations and the dashboard need, since the plugin's functions can
// only run in Node actions.

/** Version of the function contract (`PublisherPlugin`) a package was built for. Bump on a breaking change. */
export const PUBLISHER_CONTRACT_VERSION = 1;

export type PublisherPackageManifest = {
  /** Stable id, the value stored as a Publisher's `adapter`. */
  id: string;
  /** Service name shown in user-facing messages. */
  name: string;
  /** The contract version the package was built for. */
  contractVersion: number;
  /**
   * Template of a URL that opens a post in the service's own UI. `{url}` is the
   * connection URL (trailing slashes removed), `{id}` the post's external id
   * (URL-encoded). Absent when the service has no such page.
   */
  postUrl?: string;
};

export type ManifestResult = { ok: true; manifest: PublisherPackageManifest } | { ok: false; error: string };

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const POST_URL_PLACEHOLDERS = new Set(["{url}", "{id}"]);

/** Reads and validates a manifest; refuses a package built for another contract version. */
export function parsePublisherManifest(raw: unknown): ManifestResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: "The manifest must be an object" };
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== "string" || !ID_PATTERN.test(m.id)) return { ok: false, error: "The manifest `id` must be lowercase letters, digits and dashes" };
  if (typeof m.name !== "string" || m.name.trim() === "") return { ok: false, error: "The manifest `name` must be a non-empty string" };
  if (typeof m.contractVersion !== "number" || !Number.isInteger(m.contractVersion)) {
    return { ok: false, error: "The manifest `contractVersion` must be an integer" };
  }
  if (m.contractVersion !== PUBLISHER_CONTRACT_VERSION) {
    return {
      ok: false,
      error: `${m.name} was built for Publisher contract ${m.contractVersion}, this OpenGroow supports contract ${PUBLISHER_CONTRACT_VERSION}`,
    };
  }
  let postUrl: string | undefined;
  if (m.postUrl !== undefined) {
    if (typeof m.postUrl !== "string" || !/^https?:\/\/|^\{url\}/.test(m.postUrl)) {
      return { ok: false, error: "The manifest `postUrl` must start with {url} or http(s)://" };
    }
    const unknown = (m.postUrl.match(/\{[^}]*\}/g) ?? []).find((p) => !POST_URL_PLACEHOLDERS.has(p));
    if (unknown) return { ok: false, error: `The manifest \`postUrl\` uses an unknown placeholder ${unknown} (only {url} and {id})` };
    if (/[{}]/.test(m.postUrl.replace(/\{(?:url|id)\}/g, ""))) return { ok: false, error: "The manifest `postUrl` has an unbalanced brace" };
    if (!m.postUrl.includes("{id}")) return { ok: false, error: "The manifest `postUrl` must contain {id}: each post needs its own link" };
    // {url} is the connection's base URL: it can only begin the link, never sit inside another one.
    if (m.postUrl.indexOf("{url}", 1) !== -1) return { ok: false, error: "The manifest `postUrl` can only use {url} at its start" };
    postUrl = m.postUrl;
  }
  return { ok: true, manifest: { id: m.id, name: m.name, contractVersion: m.contractVersion, ...(postUrl ? { postUrl } : {}) } };
}

/** Fills a `postUrl` template for a connection and a post. */
export function renderPostUrl(template: string, conn: { url: string }, externalId: string): string {
  // One pass, with a function: neither the connection URL nor the id is read as a template (`{id}`, `$&`).
  const base = conn.url.replace(/\/+$/, "");
  return template.replace(/\{(url|id)\}/g, (_, key: string) => (key === "url" ? base : encodeURIComponent(externalId)));
}
