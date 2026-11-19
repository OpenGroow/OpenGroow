/**
 * Publisher packages (ADR-072): checking a folder with the SDK's own readers
 * (the ones the product runs at installation) and building the release asset.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { packBundle, readJson, type CheckedPackage, type PackageJson } from "./pack-common.js";
import { parseCapabilities } from "../../publisher-sdk/src/capabilities.js";
import { parsePublisherManifest, type PublisherPackageManifest } from "../../publisher-sdk/src/manifest.js";

/** Throws a readable message when the folder is not a valid Publisher package. */
export function checkPublisherFolder(dir: string): CheckedPackage<PublisherPackageManifest> {
  const pkg = readJson<PackageJson>(join(dir, "package.json"));
  if (!pkg.name || !pkg.version) throw new Error("package.json needs a name and a version");
  for (const file of ["manifest.json", "data/capabilities.json", "data/channel-options.json", "src/index.ts"]) {
    if (!existsSync(join(dir, file))) throw new Error(`${file} is missing`);
  }
  const manifest = parsePublisherManifest(readJson(join(dir, "manifest.json")));
  if (!manifest.ok) throw new Error(manifest.error);
  if (pkg.name.slice(pkg.name.indexOf("/") + 1) !== `publisher-${manifest.manifest.id}`) {
    throw new Error(`The package is named ${pkg.name} but its manifest declares the Publisher "${manifest.manifest.id}": expected the name publisher-${manifest.manifest.id}`);
  }
  parseCapabilities(readJson(join(dir, "data/capabilities.json")));
  const options = readJson<{ schemaVersion?: unknown; platforms?: unknown } | null>(join(dir, "data/channel-options.json"));
  if (!options || options.schemaVersion !== 1 || typeof options.platforms !== "object" || options.platforms === null) {
    throw new Error("data/channel-options.json must be { schemaVersion: 1, platforms: {...} }");
  }
  return { pkg: { ...pkg, name: pkg.name, version: pkg.version }, manifest: manifest.manifest };
}

/** Packs a publisher package (see `packBundle`); with `indexFile`, upserts its entry in a `publishers.json`. */
export function packPublisher(dir: string, outDir: string, options: { indexFile?: string } = {}): { tag: string; asset: string; digest: string; file: string } {
  return packBundle("publisher", dir, outDir, checkPublisherFolder(dir), options);
}
