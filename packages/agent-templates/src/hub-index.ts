/**
 * The OpenGroow hub index (#668): a `index.json` at the root of a GitHub
 * repository listing the installable Templates with where to fetch them (Git
 * repository and tag), the sha256 of their release archive (what installation
 * verifies, see `git-archive.ts`), their category and their trust level.
 *
 *   { "schemaVersion": 1,
 *     "packages": [{ "id": "@opengroow/seo", "name": "SEO", "description": "...",
 *                    "repository": "opengroow/seo-agent", "tag": "v1.2.0",
 *                    "digest": "sha256:<64 hex>", "category": "marketing",
 *                    "verification": "official" }] }
 *
 * Validation is strict, like the OpenGroow profile: an unknown key is refused
 * with a message naming it, so a too-new index is never half-understood. The
 * `fetch` is injected so tests never touch the network.
 */
import { assetField, isValidGitAsset, isValidGitTag, parseGitHubRepository, type FetchLike } from "./git-archive.js";
import { OFFICIAL_SCOPE } from "./official-scope";

export const HUB_INDEX_SCHEMA_VERSION = 1;
export const HUB_INDEX_PATH = "index.json";

/**
 * Hub packages that are not Templates (ADR-072) are listed in an index of their
 * own, never in `index.json`: that reader refuses any key it does not know, so
 * a new kind of entry there would make every deployed OpenGroow refuse the
 * whole catalogue, Templates included.
 */
import { HUB_PACKAGE_KINDS, type HubPackageKind } from "./hub-package-kinds.js";
export { HUB_PACKAGE_KINDS, type HubPackageKind };
export const hubPackageIndexPath = (kind: HubPackageKind) => `${kind}s.json`;

const LOCAL_HUB_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "host.docker.internal"]);

/**
 * The base URL of a hub served from the developer's machine (`pnpm hub:serve`),
 * used instead of GitHub to try a package before it is released: `<base>/publishers.json`
 * and `<base>/releases/<tag>/<asset>`. Only a loopback host (or Docker's
 * `host.docker.internal`) is accepted, so the setting can never point a
 * deployment at a remote server; the digest check still applies. Returns the
 * URL without a trailing slash; throws on anything else.
 */
export function parseLocalHubUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`OPENGROOW_HUB_URL "${raw}" is not a URL`);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !LOCAL_HUB_HOSTS.has(url.hostname)) {
    throw new Error(`OPENGROOW_HUB_URL must be an http(s) URL on localhost, 127.0.0.1 or host.docker.internal, not "${raw}"`);
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new Error(`OPENGROOW_HUB_URL must be a bare origin (no path, query or fragment), not "${raw}"`);
  }
  return url.origin;
}

export const HUB_VERIFICATIONS = ["official", "verified", "community"] as const;
export type HubVerification = (typeof HUB_VERIFICATIONS)[number];

export type HubEntry = {
  /** Scoped Template id (`@scope/name`). The downloaded package must declare the same one. */
  id: string;
  name: string;
  description: string;
  repository: string;
  tag: string;
  /** Optional `*.tgz` attached to the release of `tag` (a monorepo package, #672); absent: the tag archive of a one-package repository. */
  asset?: string;
  /** `sha256:<hex>` of the release archive (or of the asset when there is one). */
  digest: string;
  category: string;
  verification: HubVerification;
};

export type HubIndex = { schemaVersion: typeof HUB_INDEX_SCHEMA_VERSION; packages: HubEntry[] };
export type ParsedHubIndex = { ok: true; index: HubIndex } | { ok: false; reason: string };

/** An entry of a non-Template index: a Template entry without `category`. */
export type HubPackageEntry = Omit<HubEntry, "category"> & {
  /** The package's logo as an image data URI, shown before it is installed (kinds that have one, such as Publishers). */
  icon?: string;
};
export type HubPackageIndex = { schemaVersion: typeof HUB_INDEX_SCHEMA_VERSION; packages: HubPackageEntry[] };
export type ParsedHubPackageIndex = { ok: true; index: HubPackageIndex } | { ok: false; reason: string };

const SCOPED_ID = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const PACKAGE_ENTRY_KEYS = ["id", "name", "description", "repository", "tag", "asset", "digest", "verification"] as const;
const ENTRY_KEYS = [...PACKAGE_ENTRY_KEYS, "category"] as const;
const ICON_ENTRY_KEYS = [...PACKAGE_ENTRY_KEYS, "icon"] as const;
// Same rule as the Publisher manifest's icon (`isValidIcon` in @opengroow/publisher-sdk): an image data URI of bounded size, base64 only.
const ICON = /^data:image\/(?:png|webp|jpeg|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_ICON_LENGTH = 64 * 1024;

class IndexError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[], where: string) {
  const unknown = Object.keys(record).find((key) => !allowed.includes(key));
  if (unknown !== undefined) throw new IndexError(`${where}: unknown key "${unknown}"`);
}

function text(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") throw new IndexError(`${where}: "${key}" must be a non-empty string`);
  return value;
}

function parsePackageEntry(raw: unknown, position: number, allowedKeys: readonly string[]): HubPackageEntry {
  const where = `packages[${position}]`;
  if (!isRecord(raw)) throw new IndexError(`${where} must be an object`);
  rejectUnknownKeys(raw, allowedKeys, where);
  const id = text(raw, "id", where);
  if (!SCOPED_ID.test(id)) throw new IndexError(`${where}: "id" must be a scoped id like @scope/name`);
  const repository = text(raw, "repository", where);
  try {
    parseGitHubRepository(repository);
  } catch {
    throw new IndexError(`${where}: "repository" must be a GitHub repository (owner/repo or https://github.com/owner/repo)`);
  }
  const tag = text(raw, "tag", where);
  if (!isValidGitTag(tag)) throw new IndexError(`${where}: "tag" is not a valid Git tag`);
  const asset = raw["asset"] === undefined ? undefined : text(raw, "asset", where);
  if (asset !== undefined && !isValidGitAsset(asset)) throw new IndexError(`${where}: "asset" must be a plain *.tgz file name`);
  const digest = text(raw, "digest", where);
  if (!DIGEST.test(digest)) throw new IndexError(`${where}: "digest" must look like sha256:<64 hex characters>`);
  const verification = raw["verification"];
  if (!HUB_VERIFICATIONS.includes(verification as HubVerification)) {
    throw new IndexError(`${where}: "verification" must be one of ${HUB_VERIFICATIONS.join(", ")}`);
  }
  // The @opengroow scope is reserved to what the hub marks official (PRD #642).
  if (id.startsWith(OFFICIAL_SCOPE) && verification !== "official") {
    throw new IndexError(`${where}: the ${OFFICIAL_SCOPE.slice(0, -1)} scope is reserved to official entries`);
  }
  return {
    id,
    name: text(raw, "name", where),
    description: text(raw, "description", where),
    repository,
    tag,
    ...assetField(asset),
    digest,
    verification: verification as HubVerification,
    ...(allowedKeys.includes("icon") && raw["icon"] !== undefined ? { icon: iconOf(raw, where) } : {}),
  };
}

function iconOf(record: Record<string, unknown>, where: string): string {
  const value = record["icon"];
  if (typeof value !== "string" || value.length > MAX_ICON_LENGTH || !ICON.test(value)) {
    throw new IndexError(`${where}: "icon" must be a png, webp, jpeg or svg data URI of at most ${MAX_ICON_LENGTH} characters`);
  }
  return value;
}

function parseEntry(raw: unknown, position: number): HubEntry {
  const entry = parsePackageEntry(raw, position, ENTRY_KEYS);
  return { ...entry, category: text(raw as Record<string, unknown>, "category", `packages[${position}]`) };
}

function parseIndex<E extends { id: string }>(input: unknown, parseOne: (raw: unknown, position: number) => E) {
  try {
    if (!isRecord(input)) throw new IndexError("The hub index must be an object");
    rejectUnknownKeys(input, ["schemaVersion", "packages"], "hub index");
    if (input["schemaVersion"] !== HUB_INDEX_SCHEMA_VERSION) {
      throw new IndexError(`Unsupported schemaVersion ${JSON.stringify(input["schemaVersion"])}: expected ${HUB_INDEX_SCHEMA_VERSION}`);
    }
    const packages = input["packages"];
    if (!Array.isArray(packages)) throw new IndexError('hub index: "packages" must be an array');
    const entries = packages.map(parseOne);
    const seen = new Set<string>();
    for (const { id } of entries) {
      if (seen.has(id)) throw new IndexError(`Duplicate entry for ${id}`);
      seen.add(id);
    }
    return { ok: true as const, index: { schemaVersion: HUB_INDEX_SCHEMA_VERSION as typeof HUB_INDEX_SCHEMA_VERSION, packages: entries } };
  } catch (error) {
    if (error instanceof IndexError) return { ok: false as const, reason: error.message };
    throw error;
  }
}

export function parseHubIndex(input: unknown): ParsedHubIndex {
  return parseIndex(input, parseEntry);
}

/** The index of a non-Template kind (`publishers.json`): the same strict reader, entries without `category`. */
export function parseHubPackageIndex(input: unknown): ParsedHubPackageIndex {
  return parseIndex(input, (raw, position) => parsePackageEntry(raw, position, ICON_ENTRY_KEYS));
}

export function hubIndexUrl(repository: string, ref: string, path: string = HUB_INDEX_PATH): string {
  const { owner, repo } = parseGitHubRepository(repository);
  if (!isValidGitTag(ref)) throw new Error(`Invalid hub ref "${ref}"`);
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
}

async function fetchIndexJson(args: { repository: string; ref: string; fetch: FetchLike }, path: string, urlOverride?: string) {
  const url = urlOverride ?? hubIndexUrl(args.repository, args.ref, path);
  const response = await args.fetch(url);
  if (!response.ok) throw new Error(`Failed to download the hub index ${url}: HTTP ${response.status}`);
  let json: unknown;
  try {
    json = JSON.parse(await response.text());
  } catch {
    throw new Error(`The hub index ${url} is not valid JSON`);
  }
  return { url, json };
}

/** Downloads and validates the index of a hub repository; throws with the reason when it cannot. */
export async function fetchHubIndex(args: { repository: string; ref: string; fetch: FetchLike }): Promise<HubIndex> {
  const { url, json } = await fetchIndexJson(args, HUB_INDEX_PATH);
  const parsed = parseHubIndex(json);
  if (!parsed.ok) throw new Error(`Invalid hub index ${url}: ${parsed.reason}`);
  return parsed.index;
}

/** Downloads and validates the index of one non-Template kind of the hub; throws with the reason when it cannot. */
export async function fetchHubPackageIndex(args: {
  repository: string;
  ref: string;
  kind: HubPackageKind;
  fetch: FetchLike;
  /** A local hub (`parseLocalHubUrl`): read `<baseUrl>/publishers.json` instead of the GitHub repository. */
  baseUrl?: string;
}): Promise<HubPackageIndex> {
  const path = hubPackageIndexPath(args.kind);
  const { url, json } = await fetchIndexJson(args, path, args.baseUrl === undefined ? undefined : `${args.baseUrl}/${path}`);
  const parsed = parseHubPackageIndex(json);
  if (!parsed.ok) throw new Error(`Invalid hub index ${url}: ${parsed.reason}`);
  return parsed.index;
}
