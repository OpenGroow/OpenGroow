import { join } from "node:path";
import { clawPackageToTemplate } from "../claw-package.js";
import { readPackageFolder } from "../package-folder.js";
import type { AgentTemplate } from "../types.js";

/** Versioned Claw packages of the repository (`fixtures/packages/<name>`), used by the engine tests. */
export const REPO_PACKAGE_FIXTURES_DIR = join(import.meta.dirname, "..", "..", "..", "..", "fixtures", "packages");

/** Claw packages private to the agent-templates tests (`src/__fixtures__/claw/<name>`). */
const LOCAL_CLAW_FIXTURES_DIR = join(import.meta.dirname, "claw");

const asRecord = (files: Array<{ path: string; content: string }>) =>
  Object.fromEntries(files.map((file) => [file.path, file.content]));

function load(dir: string, name: string): AgentTemplate {
  const result = clawPackageToTemplate(asRecord(readPackageFolder(join(dir, name))));
  if (!result.ok) throw new Error(`Template fixture "${name}" is invalid: ${result.reason}`);
  return result.template;
}

/**
 * A Template read from a package fixture of the repository, the way the
 * registry installs it: `hello`, `source` (copy of the public `@opengroow/source`)
 * and `social-engagement` (the real package, versioned here).
 */
export const repoPackageTemplate = (name: "hello" | "source" | "engagement"): AgentTemplate =>
  load(REPO_PACKAGE_FIXTURES_DIR, name);

/**
 * A review + External Job + statusCheck + runContext Template (`@acme/seo`),
 * purpose-built for the engine tests that need a feature-rich manifest.
 */
export const seoFixtureTemplate = (): AgentTemplate => load(LOCAL_CLAW_FIXTURES_DIR, "seo");
