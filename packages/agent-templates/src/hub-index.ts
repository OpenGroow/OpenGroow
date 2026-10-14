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

const SCOPED_ID = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ENTRY_KEYS = ["id", "name", "description", "repository", "tag", "asset", "digest", "category", "verification"] as const;

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

function parseEntry(raw: unknown, position: number): HubEntry {
  const where = `packages[${position}]`;
  if (!isRecord(raw)) throw new IndexError(`${where} must be an object`);
  rejectUnknownKeys(raw, ENTRY_KEYS, where);
  const id = text(raw, "id", where);
  if (!SCOPED_ID.test(id)) throw new IndexError(`${where}: "id" must be a scoped Template id like @scope/name`);
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
    category: text(raw, "category", where),
    verification: verification as HubVerification,
  };
}

export function parseHubIndex(input: unknown): ParsedHubIndex {
  try {
    if (!isRecord(input)) throw new IndexError("The hub index must be an object");
    rejectUnknownKeys(input, ["schemaVersion", "packages"], "hub index");
    if (input["schemaVersion"] !== HUB_INDEX_SCHEMA_VERSION) {
      throw new IndexError(`Unsupported schemaVersion ${JSON.stringify(input["schemaVersion"])}: expected ${HUB_INDEX_SCHEMA_VERSION}`);
    }
    const packages = input["packages"];
    if (!Array.isArray(packages)) throw new IndexError('hub index: "packages" must be an array');
    const entries = packages.map(parseEntry);
    const seen = new Set<string>();
    for (const { id } of entries) {
      if (seen.has(id)) throw new IndexError(`Duplicate entry for ${id}`);
      seen.add(id);
    }
    return { ok: true, index: { schemaVersion: HUB_INDEX_SCHEMA_VERSION, packages: entries } };
  } catch (error) {
    if (error instanceof IndexError) return { ok: false, reason: error.message };
    throw error;
  }
}

export function hubIndexUrl(repository: string, ref: string): string {
  const { owner, repo } = parseGitHubRepository(repository);
  if (!isValidGitTag(ref)) throw new Error(`Invalid hub ref "${ref}"`);
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${HUB_INDEX_PATH}`;
}

/** Downloads and validates the index of a hub repository; throws with the reason when it cannot. */
export async function fetchHubIndex(args: { repository: string; ref: string; fetch: FetchLike }): Promise<HubIndex> {
  const url = hubIndexUrl(args.repository, args.ref);
  const response = await args.fetch(url);
  if (!response.ok) throw new Error(`Failed to download the hub index ${url}: HTTP ${response.status}`);
  let json: unknown;
  try {
    json = JSON.parse(await response.text());
  } catch {
    throw new Error(`The hub index ${url} is not valid JSON`);
  }
  const parsed = parseHubIndex(json);
  if (!parsed.ok) throw new Error(`Invalid hub index ${url}: ${parsed.reason}`);
  return parsed.index;
}
