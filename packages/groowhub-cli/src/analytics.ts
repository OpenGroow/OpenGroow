/**
 * Analytics Adapter packages (ADR-078): checking a folder with the SDK's own
 * readers (the ones the product runs at installation) and building the release
 * asset, as `publisher.ts` does for Publisher packages.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSync } from "esbuild";
import { parseAnalyticsManifest, parseAnalyticsMetrics, type AnalyticsPackageManifest } from "../../publisher-sdk/src/analytics.js";

const REPOSITORY = "OpenGroow/groowhub";

type PackageJson = { name?: string; version?: string; description?: string };
type IndexEntry = { id: string; name: string; description: string; repository: string; tag: string; asset: string; digest: string; verification: string; icon?: string };

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf-8")) as T;

/** Throws a readable message when the folder is not a valid Analytics Adapter package. */
export function checkAnalyticsFolder(dir: string): { pkg: Required<Pick<PackageJson, "name" | "version">> & PackageJson; manifest: AnalyticsPackageManifest } {
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

/**
 * Bundles `src/index.ts` (default export = the adapter) into `dist/plugin.mjs`,
 * stages it with the manifest and data, and `npm pack`s it into `outDir`.
 * With `indexFile`, also upserts the package's entry in an `analytics.json`
 * (local trials only: in a release a maintainer adds the entry in a reviewed PR).
 */
export function packAnalytics(dir: string, outDir: string, options: { indexFile?: string } = {}): { tag: string; asset: string; digest: string; file: string } {
  const { pkg, manifest } = checkAnalyticsFolder(dir);
  const staging = mkdtempSync(join(tmpdir(), "analytics-pack-"));
  try {
    const bundle = buildSync({
      entryPoints: [join(dir, "src/index.ts")],
      bundle: true,
      format: "esm",
      platform: "neutral",
      mainFields: ["module", "main"],
      target: "es2022",
      write: false,
    }).outputFiles[0]!.text;
    mkdirSync(join(staging, "dist"), { recursive: true });
    writeFileSync(join(staging, "dist/plugin.mjs"), bundle);
    cpSync(join(dir, "manifest.json"), join(staging, "manifest.json"));
    cpSync(join(dir, "data"), join(staging, "data"), { recursive: true });
    writeFileSync(
      join(staging, "package.json"),
      `${JSON.stringify({ name: pkg.name, version: pkg.version, description: pkg.description, type: "module", files: ["dist", "data", "manifest.json"] }, null, 2)}\n`,
    );

    mkdirSync(outDir, { recursive: true });
    execFileSync("npm", ["pack", staging, "--pack-destination", outDir, "--silent"], { stdio: ["ignore", "ignore", "inherit"] });
    const asset = `${pkg.name.replace(/^@/, "").replace("/", "-")}-${pkg.version}.tgz`;
    const file = join(outDir, asset);
    if (!existsSync(file)) throw new Error(`npm pack did not produce ${asset} (found: ${readdirSync(outDir).join(", ")})`);
    const digest = `sha256:${createHash("sha256").update(readFileSync(file)).digest("hex")}`;
    const tag = `analytics-${manifest.id}@${pkg.version}`;

    if (options.indexFile) {
      const index = existsSync(options.indexFile) ? readJson<{ schemaVersion: number; packages: IndexEntry[] }>(options.indexFile) : { schemaVersion: 1, packages: [] };
      const previous = index.packages.find((entry) => entry.id === pkg.name);
      const entry: IndexEntry = {
        id: pkg.name,
        name: manifest.name,
        description: pkg.description ?? previous?.description ?? manifest.name,
        repository: previous?.repository ?? REPOSITORY,
        tag,
        asset,
        digest,
        verification: previous?.verification ?? "official",
        ...(manifest.icon ? { icon: manifest.icon } : {}),
      };
      index.packages = previous ? index.packages.map((p) => (p.id === pkg.name ? entry : p)) : [...index.packages, entry];
      writeFileSync(options.indexFile, `${JSON.stringify(index, null, 2)}\n`);
    }
    return { tag, asset, digest, file };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
