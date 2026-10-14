/**
 * Fetches a Claw package from a GitHub release archive (#667) and verifies it.
 * Node-only, like `package-folder.ts`: never import it from the package
 * entrypoint. The `fetch` is injected so tests never touch the network.
 *
 * The archive (`.tar.gz` of a tag) is hashed as downloaded and compared with the
 * expected digest BEFORE anything is extracted: a mismatch refuses the install.
 */
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { IGNORED, type PackageFile } from "./package-folder.js";

export type GitOrigin = {
  repository: string;
  tag: string;
  /** Release asset (`*.tgz`) the package was downloaded from; absent for a tag archive (#672). */
  asset?: string;
  archiveDigest: string;
};
/** `{ asset }` when the package comes from a release asset, `{}` for a tag archive; spread into an object so an absent asset stays absent. */
export const assetField = (asset: string | undefined): { asset?: string } => (asset === undefined ? {} : { asset });
export type FetchLike = (url: string) => Promise<Response>;

const REPOSITORY = /^(?:https:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;
const TAG = /^\w[\w.+@-]*$/;
const ASSET = /^\w[\w.-]*\.tgz$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** Owner and name of a repository given as owner/repo or a GitHub URL; anything else is refused. */
export function parseGitHubRepository(repository: string): { owner: string; repo: string } {
  const match = REPOSITORY.exec(repository);
  if (!match) {
    throw new Error(`Unsupported repository "${repository}": expected a GitHub repository (owner/repo or https://github.com/owner/repo)`);
  }
  return { owner: match[1]!, repo: match[2]! };
}

export const isValidGitTag = (tag: string) => TAG.test(tag) && !tag.includes("..");

/** A plain `*.tgz` file name: no path, no query, no `..`. */
export const isValidGitAsset = (asset: string) => ASSET.test(asset) && !asset.includes("..");

/** The canonical `https://github.com/<owner>/<repo>` of a repository given as owner/repo or a GitHub URL. */
function canonicalRepository(repository: string, tag: string): string {
  const { owner, repo } = parseGitHubRepository(repository);
  if (!isValidGitTag(tag)) throw new Error(`Invalid tag "${tag}"`);
  return `https://github.com/${owner}/${repo}`;
}

const archiveUrl = (canonical: string, tag: string) => `${canonical}/archive/refs/tags/${tag}.tar.gz`;

/** URL of a file attached to the GitHub Release of `tag` (#672). */
export function githubAssetUrl(repository: string, tag: string, asset: string): string {
  if (!isValidGitAsset(asset)) throw new Error(`Invalid release asset "${asset}": expected a plain *.tgz file name`);
  return `${canonicalRepository(repository, tag)}/releases/download/${tag}/${asset}`;
}

export function githubArchiveUrl(repository: string, tag: string): string {
  return archiveUrl(canonicalRepository(repository, tag), tag);
}

const field = (block: Buffer, start: number, length: number) =>
  block.subarray(start, start + length).toString("utf-8").replace(/\0[\s\S]*$/, "");

/**
 * The `path` record of a pax extended header (`<length> <key>=<value>\n`
 * records): `git archive`, which GitHub uses, stores paths over 100 bytes there.
 */
function paxPath(body: Buffer): string | undefined {
  let path: string | undefined;
  let offset = 0;
  while (offset < body.length) {
    const space = body.indexOf(0x20, offset);
    if (space === -1) break;
    const length = parseInt(body.subarray(offset, space).toString("utf-8"), 10);
    if (!Number.isInteger(length) || length <= space - offset) break;
    const record = body.subarray(space + 1, offset + length - 1).toString("utf-8");
    if (record.startsWith("path=")) path = record.slice("path=".length);
    offset += length;
  }
  return path;
}

const UTF8 = new TextDecoder("utf-8", { fatal: true });

/** Package files are text: a binary entry would be silently corrupted by a lossy decode, so it is refused. */
function decodeText(name: string, body: Buffer): string {
  try {
    return UTF8.decode(body);
  } catch {
    throw new Error(`Refusing archive entry "${name}": only UTF-8 text files are supported`);
  }
}

/** Regular files of a ustar archive, paths as stored. Links, devices and escaping paths are refused. */
function readTar(tar: Buffer): PackageFile[] {
  const files: PackageFile[] = [];
  let offset = 0;
  let longName: string | undefined;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = parseInt(field(header, 124, 12).trim() || "0", 8);
    const type = field(header, 156, 1) || "0";
    const prefix = field(header, 345, 155);
    const name = longName ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
    longName = undefined;
    const body = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (type === "g" || type === "5") continue; // pax global header, directories
    if (type === "x") {
      longName = paxPath(body);
      continue;
    }
    if (type === "L") {
      longName = body.toString("utf-8").replace(/\0[\s\S]*$/, "");
      continue;
    }
    if (type !== "0") throw new Error(`Refusing archive entry "${name}": only regular files are allowed`);
    if (name.startsWith("/") || name.split("/").includes("..")) throw new Error(`Refusing archive entry with unsafe path "${name}"`);
    files.push({ path: name, content: decodeText(name, body) });
  }
  return files;
}

/** The package root is the archive's single top-level folder (`<repo>-<tag>/` for a tag archive, `package/` for an npm-pack tarball). */
function stripTopLevel(files: PackageFile[]): PackageFile[] {
  const roots = new Set(files.map((f) => f.path.split("/")[0]));
  if (roots.size !== 1 || files.some((f) => !f.path.includes("/"))) {
    throw new Error("Refusing archive: expected a single top-level folder");
  }
  return files
    .map((f) => ({ path: f.path.slice(f.path.indexOf("/") + 1), content: f.content }))
    .filter((f) => !f.path.split("/").some((segment) => IGNORED.has(segment)))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
}

export async function fetchGitPackage(args: {
  repository: string;
  tag: string;
  /** `*.tgz` attached to the release of `tag`; when absent the tag's source archive is downloaded. */
  asset?: string;
  /** Expected `sha256:<hex>` of the release archive. */
  digest: string;
  fetch: FetchLike;
}): Promise<{ files: PackageFile[]; gitOrigin: GitOrigin }> {
  if (!DIGEST.test(args.digest)) throw new Error("The expected digest must look like sha256:<64 hex characters>");
  const repository = canonicalRepository(args.repository, args.tag);
  const url = args.asset === undefined ? archiveUrl(repository, args.tag) : githubAssetUrl(repository, args.tag, args.asset);

  const response = await args.fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());

  const actual = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
  if (actual !== args.digest) {
    throw new Error(`Digest mismatch for ${args.repository}@${args.tag}: expected ${args.digest}, got ${actual}. Installation refused`);
  }

  const files = stripTopLevel(readTar(gunzipSync(archive)));
  return { files, gitOrigin: { repository, tag: args.tag, ...assetField(args.asset), archiveDigest: actual } };
}
