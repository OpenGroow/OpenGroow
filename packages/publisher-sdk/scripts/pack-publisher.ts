/**
 * `pnpm publisher:pack <package folder> [--hub <hub folder>]`
 *
 * Builds a Publisher package the way a hub release does (ADR-072) and puts it
 * in a local hub checkout, to try it with `pnpm hub:serve` before anything is
 * released:
 *
 *   - bundles `src/index.ts` (default export = the plugin) into `dist/plugin.mjs`, SDK inlined;
 *   - packs it with `manifest.json`, `data/*.json` and `package.json` (`npm pack`) into `<hub>/dist/`;
 *   - writes or updates the package's entry in `<hub>/publishers.json` (tag, asset, sha256 digest).
 *
 * The hub folder defaults to `../groowhub` next to the OpenGroow checkout. In
 * a real release the entry is added by a maintainer in a reviewed PR and the
 * release workflow moves tag, asset and digest; here the script does both,
 * because nothing is published.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { parseCapabilities } from "../src/capabilities";
import { parsePublisherManifest } from "../src/manifest";

const REPOSITORY = "OpenGroow/groowhub";

type IndexEntry = { id: string; name: string; description: string; repository: string; tag: string; asset: string; digest: string; verification: string };
type PackageJson = { name?: string; version?: string; description?: string };

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf-8")) as T;

function parseArgs(argv: string[]): { packageDir: string; hubDir: string } {
  const base = process.env.INIT_CWD ?? process.cwd();
  let packageDir: string | undefined;
  let hubDir = resolve(base, "../groowhub");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--hub") hubDir = resolve(base, argv[++i] ?? "");
    else if (!packageDir) packageDir = resolve(base, argv[i]!);
  }
  if (!packageDir) throw new Error("Usage: publisher:pack <package folder> [--hub <hub folder>]");
  return { packageDir, hubDir };
}

export function packPublisher(packageDir: string, hubDir: string): { tag: string; asset: string; digest: string; file: string } {
  const pkg = readJson<PackageJson>(join(packageDir, "package.json"));
  if (!pkg.name || !pkg.version) throw new Error("package.json needs a name and a version");

  const manifest = parsePublisherManifest(readJson(join(packageDir, "manifest.json")));
  if (!manifest.ok) throw new Error(manifest.error);
  const { id, name } = manifest.manifest;
  if (pkg.name.slice(pkg.name.indexOf("/") + 1) !== `publisher-${id}`) {
    throw new Error(`The package is named ${pkg.name} but its manifest declares the Publisher "${id}": expected the name publisher-${id}`);
  }
  parseCapabilities(readJson(join(packageDir, "data/capabilities.json")));
  if (!existsSync(join(packageDir, "data/channel-options.json"))) throw new Error("data/channel-options.json is missing");

  const staging = mkdtempSync(join(tmpdir(), "publisher-pack-"));
  try {
    const bundle = buildSync({
      entryPoints: [join(packageDir, "src/index.ts")],
      bundle: true,
      format: "esm",
      platform: "neutral",
      mainFields: ["module", "main"],
      target: "es2022",
      write: false,
    }).outputFiles[0]!.text;
    mkdirSync(join(staging, "dist"), { recursive: true });
    writeFileSync(join(staging, "dist/plugin.mjs"), bundle);
    cpSync(join(packageDir, "manifest.json"), join(staging, "manifest.json"));
    cpSync(join(packageDir, "data"), join(staging, "data"), { recursive: true });
    writeFileSync(
      join(staging, "package.json"),
      `${JSON.stringify({ name: pkg.name, version: pkg.version, description: pkg.description, type: "module", files: ["dist", "data", "manifest.json"] }, null, 2)}\n`,
    );

    const distDir = join(hubDir, "dist");
    mkdirSync(distDir, { recursive: true });
    execFileSync("npm", ["pack", staging, "--pack-destination", distDir, "--silent"], { stdio: ["ignore", "ignore", "inherit"] });
    const asset = `${pkg.name.replace(/^@/, "").replace("/", "-")}-${pkg.version}.tgz`;
    const file = join(distDir, asset);
    if (!existsSync(file)) throw new Error(`npm pack did not produce ${asset} (found: ${readdirSync(distDir).join(", ")})`);
    const digest = `sha256:${createHash("sha256").update(readFileSync(file)).digest("hex")}`;
    const tag = `publisher-${id}@${pkg.version}`;

    const indexFile = join(hubDir, "publishers.json");
    const index = existsSync(indexFile) ? readJson<{ schemaVersion: number; packages: IndexEntry[] }>(indexFile) : { schemaVersion: 1, packages: [] };
    const previous = index.packages.find((entry) => entry.id === pkg.name);
    const entry: IndexEntry = {
      id: pkg.name,
      name,
      description: pkg.description ?? previous?.description ?? name,
      repository: previous?.repository ?? REPOSITORY,
      tag,
      asset,
      digest,
      verification: previous?.verification ?? "official",
    };
    index.packages = previous ? index.packages.map((p) => (p.id === pkg.name ? entry : p)) : [...index.packages, entry];
    writeFileSync(indexFile, `${JSON.stringify(index, null, 2)}\n`);
    return { tag, asset, digest, file };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { packageDir, hubDir } = parseArgs(process.argv.slice(2));
    const result = packPublisher(packageDir, hubDir);
    console.log(`${basename(result.file)}  ${result.digest}\n${result.tag} -> ${join(hubDir, "publishers.json")}\nNext: pnpm hub:serve ${hubDir}`);
  } catch (error) {
    console.error(`ERROR ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
