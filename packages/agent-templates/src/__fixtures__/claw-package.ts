import { join } from "node:path";
import { readPackageFolder, type PackageFile } from "../package-folder";

const CLAW_FIXTURES_DIR = join(import.meta.dirname, "claw");

export type { PackageFile };

/** Files of a Claw package fixture of the agent-templates package. */
export function readClawPackageFixture(name: string): PackageFile[] {
  return readPackageFolder(join(CLAW_FIXTURES_DIR, name));
}

/**
 * A package fixture as the hosted deployment accepts it (#670): the fixtures
 * declare local development MCP URLs (host.docker.internal, localhost), which
 * the hosted deployment refuses at install; this one points the servers at a
 * public host.
 */
export function readHostedClawPackageFixture(name: string): PackageFile[] {
  const files = readClawPackageFixture(name);
  const profile = files.find((f) => f.path === "profiles/opengroow.yml")!.content;
  const hosted = profile
    .replace(/^(\s+)url: http:\/\/host\.docker\.internal:\d+\/mcp$/m, "$1url: https://seo.example.com/mcp")
    .replace(/^\s+activationUrl: .*\n/m, "")
    .replace(/^\s+publicBaseUrl: .*\n/m, "");
  return withFile(files, "profiles/opengroow.yml", hosted);
}

/** Replaces (or adds) one file of a package. */
export function withFile(files: readonly PackageFile[], path: string, content: string): PackageFile[] {
  return [...files.filter((f) => f.path !== path), { path, content }];
}
