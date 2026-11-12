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
  /**
   * The service's logo as an image data URI (`data:image/png;base64,...`, png,
   * webp, jpeg or svg, at most `MAX_ICON_LENGTH` characters). A package is text
   * only (the installer refuses binary files), and the dashboard shows the
   * logo as-is, so it travels inside the manifest.
   */
  icon?: string;
  /**
   * False when the service cannot publish at a later date (a GitHub commit is
   * immediate, ADR-074): the core then refuses a `publishAt` on its channels.
   * Absent means the service can schedule.
   */
  scheduling?: false;
};

export type ManifestResult = { ok: true; manifest: PublisherPackageManifest } | { ok: false; error: string };

export const MAX_ICON_LENGTH = 64 * 1024;
const ICON_PATTERN = /^data:image\/(?:png|webp|jpeg|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Whether `value` is an icon the dashboard may show: an image data URI of bounded size. */
export const isValidIcon = (value: unknown): value is string => typeof value === "string" && value.length <= MAX_ICON_LENGTH && ICON_PATTERN.test(value);

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
  if (m.icon !== undefined && !isValidIcon(m.icon)) {
    return { ok: false, error: `The manifest \`icon\` must be a png, webp, jpeg or svg data URI of at most ${MAX_ICON_LENGTH} characters` };
  }
  if (m.scheduling !== undefined && typeof m.scheduling !== "boolean") {
    return { ok: false, error: "The manifest `scheduling` must be a boolean" };
  }
  return {
    ok: true,
    manifest: {
      id: m.id,
      name: m.name,
      contractVersion: m.contractVersion,
      ...(postUrl ? { postUrl } : {}),
      ...(m.icon ? { icon: m.icon } : {}),
      ...(m.scheduling === false ? { scheduling: false as const } : {}),
    },
  };
}

/** Fills a `postUrl` template for a connection and a post. */
export function renderPostUrl(template: string, conn: { url: string }, externalId: string): string {
  // One pass, with a function: neither the connection URL nor the id is read as a template (`{id}`, `$&`).
  const base = conn.url.replace(/\/+$/, "");
  return template.replace(/\{(url|id)\}/g, (_, key: string) => (key === "url" ? base : encodeURIComponent(externalId)));
}

/**
 * Checks a plugin loaded from a package's bundle (its default export) against
 * the package's manifest, before the core calls it: the right functions are
 * there and the identity matches. The bundle is code the hub verified, but a
 * mismatch (a bundle built for another contract or another Publisher) must
 * fail with a clear message instead of at the first call.
 */
const PLUGIN_FUNCTIONS = ["testConnection", "listChannels", "publish", "findPost", "getStatus"] as const;

export function checkPublisherPlugin(plugin: unknown, manifest: PublisherPackageManifest): { ok: true } | { ok: false; error: string } {
  if (typeof plugin !== "object" || plugin === null) return { ok: false, error: `${manifest.name}: the bundle has no default export` };
  const p = plugin as Record<string, unknown>;
  if (p.id !== manifest.id) return { ok: false, error: `${manifest.name}: the bundle is the plugin "${String(p.id)}", the manifest declares "${manifest.id}"` };
  if (p.contractVersion !== manifest.contractVersion) {
    return { ok: false, error: `${manifest.name}: the bundle implements contract ${String(p.contractVersion)}, the manifest declares ${manifest.contractVersion}` };
  }
  const missing = PLUGIN_FUNCTIONS.filter((name) => typeof p[name] !== "function");
  if (missing.length > 0) return { ok: false, error: `${manifest.name}: the bundle lacks ${missing.join(", ")}` };
  return { ok: true };
}
