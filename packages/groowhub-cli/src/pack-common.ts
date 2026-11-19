/**
 * What packing a hub package has in common, whatever its kind (ADR-072, ADR-078): bundling
 * `src/index.ts`, staging it with the manifest and data, `npm pack`, the digest and the
 * index entry. A kind (`publisher.ts`, `analytics.ts`) brings only its own folder check.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSync } from "esbuild";

const REPOSITORY = "OpenGroow/groowhub";

export type PackageJson = { name?: string; version?: string; description?: string };
export type CheckedPackage<M> = { pkg: Required<Pick<PackageJson, "name" | "version">> & PackageJson; manifest: M };
type IndexEntry = { id: string; name: string; description: string; repository: string; tag: string; asset: string; digest: string; verification: string; icon?: string };

export const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf-8")) as T;

/**
 * Bundles `src/index.ts` (default export = the plugin) into `dist/plugin.mjs`, stages it with the
 * manifest and data, and `npm pack`s it into `outDir`. With `indexFile`, also upserts the package's
 * entry in the kind's index (local trials only: in a release a maintainer adds the entry in a reviewed PR).
 * `kind` names the staging folder and the release tag (`<kind>-<id>@<version>`).
 */
export function packBundle(
  kind: string,
  dir: string,
  outDir: string,
  { pkg, manifest }: CheckedPackage<{ id: string; name: string; icon?: string }>,
  options: { indexFile?: string } = {},
): { tag: string; asset: string; digest: string; file: string } {
  const staging = mkdtempSync(join(tmpdir(), `${kind}-pack-`));
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
    const tag = `${kind}-${manifest.id}@${pkg.version}`;

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
