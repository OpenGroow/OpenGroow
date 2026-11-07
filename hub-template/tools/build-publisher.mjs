#!/usr/bin/env node
/**
 * Builds a Publisher package the way a release does (ADR-072 of the OpenGroow repository):
 *
 *   node tools/build-publisher.mjs packages/publisher/postiz dist
 *
 * It bundles `src/index.ts` (default export = the plugin) into `dist/plugin.mjs`,
 * stages it with `manifest.json`, `data/*.json` and `package.json`, and runs
 * `npm pack` into the output folder. The plugin only imports types from the SDK,
 * so the bundle is self-contained. Prints the path of the .tgz.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const readJson = (file) => JSON.parse(readFileSync(file, "utf-8"));

export function checkPublisherFolder(dir) {
  const pkg = readJson(join(dir, "package.json"));
  if (!pkg.name || !pkg.version) throw new Error(`${dir}: package.json needs a name and a version`);
  for (const file of ["manifest.json", "data/capabilities.json", "data/channel-options.json", "src/index.ts"]) {
    if (!existsSync(join(dir, file))) throw new Error(`${dir}: ${file} is missing`);
  }
  const manifest = readJson(join(dir, "manifest.json"));
  if (typeof manifest.id !== "string" || typeof manifest.name !== "string" || manifest.contractVersion !== 1) {
    throw new Error(`${dir}: manifest.json needs an id, a name and "contractVersion": 1`);
  }
  if (pkg.name.slice(pkg.name.indexOf("/") + 1) !== `publisher-${manifest.id}`) {
    throw new Error(`${dir}: the package is named ${pkg.name} but the manifest declares "${manifest.id}": expected publisher-${manifest.id}`);
  }
  return { pkg, manifest };
}

export function buildPublisher(dir, outDir) {
  const { pkg } = checkPublisherFolder(dir);
  const staging = mkdtempSync(join(tmpdir(), "publisher-build-"));
  try {
    const bundle = buildSync({
      entryPoints: [join(dir, "src/index.ts")],
      bundle: true,
      format: "esm",
      platform: "neutral",
      mainFields: ["module", "main"],
      target: "es2022",
      write: false,
    }).outputFiles[0].text;
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
    const file = join(outDir, `${pkg.name.replace(/^@/, "").replace("/", "-")}-${pkg.version}.tgz`);
    if (!existsSync(file)) throw new Error(`npm pack did not produce ${file}`);
    return file;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [dir, outDir] = process.argv.slice(2);
    if (!dir || !outDir) throw new Error("Usage: build-publisher.mjs <package folder> <output folder>");
    console.log(buildPublisher(resolve(dir), resolve(outDir)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
