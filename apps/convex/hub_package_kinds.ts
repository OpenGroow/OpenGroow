import { parseCapabilities, parsePublisherManifest } from "@opengroow/publisher-sdk";
import type { HubPackageKind } from "@opengroow/agent-templates/hub-index";
import type { PackageFile } from "./template_registry_store.js";

// What each kind of hub package must contain (ADR-072), checked at install,
// before anything is stored. The hub layer calls `problemWith` and knows nothing
// else about a kind. Pure: usable from any runtime.

const MAX_FILES = 50;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;

function readJson(files: readonly PackageFile[], path: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const file = files.find((f) => f.path === path);
  if (!file) return { ok: false, error: `${path} is missing` };
  try {
    return { ok: true, value: JSON.parse(file.content) };
  } catch {
    return { ok: false, error: `${path} is not valid JSON` };
  }
}

function publisherProblem(entry: { id: string }, files: readonly PackageFile[]): string | undefined {
  const manifestFile = readJson(files, "manifest.json");
  if (!manifestFile.ok) return manifestFile.error;
  const manifest = parsePublisherManifest(manifestFile.value);
  if (!manifest.ok) return manifest.error;

  // The adapter id a Publisher is stored with must be the package's own: a package cannot take another one's.
  const name = entry.id.slice(entry.id.indexOf("/") + 1);
  if (name !== `publisher-${manifest.manifest.id}`) {
    return `The hub lists ${entry.id} but the manifest declares the Publisher "${manifest.manifest.id}": expected the package name publisher-${manifest.manifest.id}`;
  }

  const bundle = files.find((f) => f.path === "dist/plugin.mjs");
  if (!bundle || bundle.content.trim() === "") return "dist/plugin.mjs is missing or empty";

  const capabilities = readJson(files, "data/capabilities.json");
  if (!capabilities.ok) return capabilities.error;
  try {
    parseCapabilities(capabilities.value);
  } catch (error) {
    return `data/capabilities.json: ${error instanceof Error ? error.message : String(error)}`;
  }
  const options = readJson(files, "data/channel-options.json");
  if (!options.ok) return options.error;
  const o = options.value as { schemaVersion?: unknown; platforms?: unknown } | null;
  if (!o || o.schemaVersion !== 1 || typeof o.platforms !== "object" || o.platforms === null) {
    return "data/channel-options.json must be { schemaVersion: 1, platforms: {...} }";
  }
  return undefined;
}

/** Why a downloaded package must not be installed as `kind`, or undefined when it is acceptable. */
export function problemWith(kind: HubPackageKind, entry: { id: string }, files: readonly PackageFile[]): string | undefined {
  if (files.length === 0) return "The package is empty";
  if (files.length > MAX_FILES) return `The package has ${files.length} files, the limit is ${MAX_FILES}`;
  const bytes = files.reduce((sum, f) => sum + Buffer.byteLength(f.content), 0);
  if (bytes > MAX_TOTAL_BYTES) return `The package is ${bytes} bytes, the limit is ${MAX_TOTAL_BYTES}`;
  switch (kind) {
    case "publisher":
      return publisherProblem(entry, files);
  }
}
