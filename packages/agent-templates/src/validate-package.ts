/**
 * Validates a Claw package the way installation does (#672): the same reader
 * (`clawPackageToTemplate`) plus the release rules a publisher needs (a semver
 * version, a release tag `<name>@<version>` matching the package). Node-only
 * (`validatePackageFolder` reads the disk): it backs the `template:validate`
 * CLI that Template repositories run in CI, never the package entrypoint.
 */
import { clawPackageToTemplate } from "./claw-package.js";
import { readPackageFolder, type PackageFile } from "./package-folder.js";

export type PackageValidation =
  | { ok: true; id: string; version: string }
  | { ok: false; errors: string[] };

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function readVersion(source: string | undefined): string | undefined {
  try {
    const version = (JSON.parse(source ?? "") as { version?: unknown }).version;
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}

export function validatePackage(files: readonly PackageFile[], options: { tag?: string } = {}): PackageValidation {
  const paths = new Set(files.map((f) => f.path));
  if (paths.size !== files.length) return { ok: false, errors: ["The package contains duplicate file paths"] };

  const converted = clawPackageToTemplate(Object.fromEntries(files.map((f) => [f.path, f.content])));
  if (!converted.ok) return { ok: false, errors: [converted.reason] };
  const id = converted.template.manifest.id;

  const errors: string[] = [];
  const version = readVersion(files.find((f) => f.path === "package.json")?.content);
  if (version === undefined || !SEMVER.test(version)) {
    errors.push('package.json "version" must be a semver version like 1.2.3');
  }
  if (options.tag !== undefined) {
    const expected = `${id.slice(id.indexOf("/") + 1)}@${version}`;
    if (options.tag !== expected) errors.push(`Release tag "${options.tag}" does not match the package: expected "${expected}"`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, id, version: version! };
}

export function validatePackageFolder(root: string, options: { tag?: string } = {}): PackageValidation {
  try {
    return validatePackage(readPackageFolder(root), options);
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}
