/**
 * Analytics Adapter packages (ADR-078): checking a folder with the SDK's own
 * readers (the ones the product runs at installation) and building the release
 * asset, as `publisher.ts` does for Publisher packages.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { packBundle, readJson, type CheckedPackage, type PackageJson } from "./pack-common.js";
import { parseAnalyticsManifest, parseAnalyticsMetrics, type AnalyticsPackageManifest } from "../../publisher-sdk/src/analytics.js";

/** Throws a readable message when the folder is not a valid Analytics Adapter package. */
export function checkAnalyticsFolder(dir: string): CheckedPackage<AnalyticsPackageManifest> {
  const pkg = readJson<PackageJson>(join(dir, "package.json"));
  if (!pkg.name || !pkg.version) throw new Error("package.json needs a name and a version");
  for (const file of ["manifest.json", "data/metrics.json", "src/index.ts"]) {
    if (!existsSync(join(dir, file))) throw new Error(`${file} is missing`);
  }
  const manifest = parseAnalyticsManifest(readJson(join(dir, "manifest.json")));
  if (!manifest.ok) throw new Error(manifest.error);
  if (pkg.name.slice(pkg.name.indexOf("/") + 1) !== `analytics-${manifest.manifest.id}`) {
    throw new Error(`The package is named ${pkg.name} but its manifest declares the adapter "${manifest.manifest.id}": expected the name analytics-${manifest.manifest.id}`);
  }
  try {
    if (parseAnalyticsMetrics(readJson(join(dir, "data/metrics.json"))).adapter !== manifest.manifest.id) {
      throw new Error(`is for another adapter than "${manifest.manifest.id}"`);
    }
  } catch (error) {
    throw new Error(`data/metrics.json ${error instanceof Error ? error.message : String(error)}`);
  }
  return { pkg: { ...pkg, name: pkg.name, version: pkg.version }, manifest: manifest.manifest };
}

/** Packs an analytics package (see `packBundle`); with `indexFile`, upserts its entry in a `analytics.json`. */
export function packAnalytics(dir: string, outDir: string, options: { indexFile?: string } = {}): { tag: string; asset: string; digest: string; file: string } {
  return packBundle("analytics", dir, outDir, checkAnalyticsFolder(dir), options);
}
