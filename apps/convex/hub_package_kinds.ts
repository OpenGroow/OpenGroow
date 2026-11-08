import { parseCapabilities, parsePublisherManifest, type CapabilitiesData, type ChannelOptionsData } from "@opengroow/publisher-sdk";
import { HUB_PACKAGE_KINDS, type HubPackageKind } from "@opengroow/agent-templates/hub-package-kinds";
import { v } from "convex/values";
import type { PackageFile } from "./template_registry_store.js";

// What each kind of hub package must contain (ADR-072), checked at install,
// before anything is stored. The hub layer calls `problemWith` and knows nothing
// else about a kind. Pure: usable from any runtime.

export const MAX_FILES = 50;
export const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
/** Download and unpacked limits applied while fetching, before `problemWith` sees any file. */
export const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024;
export const MAX_UNPACKED_BYTES = 8 * 1024 * 1024;

/** The kinds of hub package, as a validator. */
export const kindV = v.union(...HUB_PACKAGE_KINDS.map((k) => v.literal(k)));

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `publisher-postiz@1.2.0` -> `{ name: "publisher-postiz", version: "1.2.0" }`; undefined when the tag is not `<name>@<version>`. */
export function parseTag(tag: string): { name: string; version: string } | undefined {
  const at = tag.lastIndexOf("@");
  if (at <= 0 || at === tag.length - 1) return undefined;
  return { name: tag.slice(0, at), version: tag.slice(at + 1) };
}

function readJson(files: readonly PackageFile[], path: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const file = files.find((f) => f.path === path);
  if (!file) return { ok: false, error: `${path} is missing` };
  try {
    return { ok: true, value: JSON.parse(file.content) };
  } catch {
    return { ok: false, error: `${path} is not valid JSON` };
  }
}

function publisherProblem(entry: { id: string; tag: string }, files: readonly PackageFile[]): string | undefined {
  const manifestFile = readJson(files, "manifest.json");
  if (!manifestFile.ok) return manifestFile.error;
  const manifest = parsePublisherManifest(manifestFile.value);
  if (!manifest.ok) return manifest.error;

  // The adapter id a Publisher is stored with must be the package's own: a package cannot take another one's.
  const name = entry.id.slice(entry.id.indexOf("/") + 1);
  if (name !== `publisher-${manifest.manifest.id}`) {
    return `The hub lists ${entry.id} but the manifest declares the Publisher "${manifest.manifest.id}": expected the package name publisher-${manifest.manifest.id}`;
  }

  const adapter = manifest.manifest.id;
  const bundle = files.find((f) => f.path === "dist/plugin.mjs");
  if (!bundle || bundle.content.trim() === "") return "dist/plugin.mjs is missing or empty";

  const capabilities = readJson(files, "data/capabilities.json");
  if (!capabilities.ok) return capabilities.error;
  try {
    if (parseCapabilities(capabilities.value).adapter !== adapter) {
      return `data/capabilities.json is for another Publisher than "${adapter}"`;
    }
  } catch (error) {
    return `data/capabilities.json: ${error instanceof Error ? error.message : String(error)}`;
  }
  const options = readJson(files, "data/channel-options.json");
  if (!options.ok) return options.error;
  const o = options.value;
  if (!isPlainObject(o) || o.schemaVersion !== 1 || !isPlainObject(o.platforms)) {
    return "data/channel-options.json must be { schemaVersion: 1, adapter, platforms: {...} }";
  }
  if (o.adapter !== adapter) return `data/channel-options.json is for another Publisher than "${adapter}"`;
  return undefined;
}

/**
 * What a Publisher package exposes to queries and the dashboard (stored as the
 * package's `meta`): the plugin's functions can only run in Node actions, so
 * everything else it carries is data (ADR-072).
 */
export type PublisherMeta = {
  /** The value stored as a Publisher's `adapter`. */
  adapter: string;
  name: string;
  postUrl?: string;
  /** The logo, an image data URI (manifest `icon`). */
  icon?: string;
  capabilities: CapabilitiesData;
  channelOptions: ChannelOptionsData;
};

/** The package's `meta`, from files that `problemWith` accepted. */
export function describe(kind: HubPackageKind, files: readonly PackageFile[]): PublisherMeta {
  switch (kind) {
    case "publisher": {
      const json = (path: string) => JSON.parse(files.find((f) => f.path === path)!.content);
      const manifest = parsePublisherManifest(json("manifest.json"));
      if (!manifest.ok) throw new Error(manifest.error);
      return {
        adapter: manifest.manifest.id,
        name: manifest.manifest.name,
        ...(manifest.manifest.postUrl ? { postUrl: manifest.manifest.postUrl } : {}),
        ...(manifest.manifest.icon ? { icon: manifest.manifest.icon } : {}),
        capabilities: parseCapabilities(json("data/capabilities.json")),
        channelOptions: json("data/channel-options.json") as ChannelOptionsData,
      };
    }
  }
}

/** Why a downloaded package must not be installed as `kind`, or undefined when it is acceptable. */
export function problemWith(kind: HubPackageKind, entry: { id: string; tag: string }, files: readonly PackageFile[]): string | undefined {
  if (files.length === 0) return "The package is empty";
  if (files.length > MAX_FILES) return `The package has ${files.length} files, the limit is ${MAX_FILES}`;
  const seen = new Set<string>();
  for (const { path } of files) {
    if (path === "" || path.startsWith("/") || path.split("/").includes("..")) return `The package has an unsafe path "${path}"`;
    if (seen.has(path)) return `The package has the file ${path} twice`;
    seen.add(path);
  }
  const tag = parseTag(entry.tag);
  if (!tag) return `The tag "${entry.tag}" must look like <package>@<version>`;
  const manifestVersion = readJson(files, "package.json");
  if (manifestVersion.ok && isPlainObject(manifestVersion.value) && manifestVersion.value.version !== tag.version) {
    return `package.json declares version ${String(manifestVersion.value.version)} but the tag is ${entry.tag}`;
  }
  const bytes = files.reduce((sum, f) => sum + Buffer.byteLength(f.content), 0);
  if (bytes > MAX_TOTAL_BYTES) return `The package is ${bytes} bytes, the limit is ${MAX_TOTAL_BYTES}`;
  switch (kind) {
    case "publisher":
      return publisherProblem(entry, files);
  }
}
