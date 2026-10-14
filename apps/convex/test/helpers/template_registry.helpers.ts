import { afterEach, beforeEach } from "vitest";
import { clawPackageToTemplate, validateManifest, type AgentTemplate } from "@opengroow/agent-templates";
import {
  createInMemoryTemplateRegistry,
  type ProjectId,
  type TemplateRegistry,
} from "@opengroow/agent-templates/registry";
import { setTemplateRegistryForTests } from "../../template_registry";

/**
 * A minimal fixture Template (no MCP server, no Mission type) with its own id
 * and manifest overrides. Independent of the built-in Templates.
 */
export function fixtureTemplate(
  id: string,
  manifest: Partial<AgentTemplate["manifest"]> = {},
): AgentTemplate {
  return {
    manifest: {
      id,
      name: `Fixture ${id}`,
      description: "Test fixture Template.",
      category: "test",
      mcpServers: [],
      visibility: "development",
      ...manifest,
    },
    agentsMd: "# Agents\n",
  };
}

/** An in-memory registry seeding each Template for each Project id. */
export function inMemoryRegistry(
  projectIds: readonly ProjectId[],
  templates: readonly AgentTemplate[],
): TemplateRegistry {
  return createInMemoryTemplateRegistry(
    projectIds.flatMap((projectId) => templates.map((template) => ({ projectId, template }))),
  );
}

/**
 * Call at module or describe level: Convex actions resolve Templates through
 * an in-memory registry in every test of that scope; the Project-backed
 * registry is restored after each test. A string is an official Template id,
 * served as its fixture (`officialFixtureTemplate`) for the listed Projects.
 */
export function useTemplateRegistry(
  projectIds: readonly ProjectId[],
  templates: readonly (AgentTemplate | string)[],
): TemplateRegistry {
  const registry = inMemoryRegistry(
    projectIds,
    templates.map((t) => (typeof t === "string" ? officialFixtureTemplate(t) : t)),
  );
  beforeEach(() => setTemplateRegistryForTests(registry));
  afterEach(() => setTemplateRegistryForTests(undefined));
  return registry;
}

// Convex bundles every file under apps/convex, tests included, and refuses a
// static `node:` import. These resolve the Node modules at call time instead,
// which only ever happens under vitest.
const nodeFs = () => process.getBuiltinModule("node:fs");
const join = (...parts: string[]): string => process.getBuiltinModule("node:path").join(...parts);

/** Reads a package folder the way the registry installs it (relative paths, forward slashes). */
function readPackageFiles(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of nodeFs().readdirSync(dir).sort()) {
      const path = join(dir, entry);
      if (nodeFs().statSync(path).isDirectory()) walk(path);
      else files[path.slice(root.length + 1).split("\\").join("/")] = nodeFs().readFileSync(path, "utf-8");
    }
  };
  walk(root);
  return files;
}

/** A versioned Claw package of the repository (`fixtures/packages/<name>`), converted like an installed one. */
export function repoPackageTemplate(name: "hello" | "source" | "engagement"): AgentTemplate {
  const result = clawPackageToTemplate(readPackageFiles(join(process.cwd(), "fixtures", "packages", name)));
  if (!result.ok) throw new Error(`Package fixture "${name}" is invalid: ${result.reason}`);
  return result.template;
}

/**
 * The fixture standing in for an official Template id in the engine tests.
 * No Template content is compiled into the product (#674): `hello`, `source`
 * and `social-engagement` are the packages versioned under `fixtures/packages`,
 * the others are purpose-built manifests under `test/fixtures/templates`.
 */
export function officialFixtureTemplate(id: string): AgentTemplate {
  switch (id) {
    case "@opengroow/hello":
      return repoPackageTemplate("hello");
    case "@opengroow/source":
      return repoPackageTemplate("source");
    case "@opengroow/engagement":
      return repoPackageTemplate("engagement");
    case "@opengroow/seo":
      return loadFixtureTemplate("seo");
    case "@opengroow/video-demo":
      return loadFixtureTemplate("video-demo");
    case "@opengroow/visual-social":
      return loadFixtureTemplate("visual-social");
    case "@opengroow/openmontage-agent":
      return loadFixtureTemplate("openmontage-agent");
    default:
      throw new Error(`No fixture for the official Template ${id}`);
  }
}

// A function, not a constant: Convex bundles this file and must not evaluate process.cwd() at load.
export const fixtureTemplatesDir = () => `${process.cwd()}/apps/convex/test/fixtures/templates`;

/** Loads a Template fixture folder from `test/fixtures/templates` (manifest.json, AGENTS.md and the files it references). */
export function loadFixtureTemplate(id: string): AgentTemplate {
  const dir = join(fixtureTemplatesDir(), id);
  const read = (relativePath: string, what: string): string => {
    const path = join(dir, relativePath);
    if (!nodeFs().existsSync(path)) throw new Error(`Template fixture "${id}": ${what} not found at ${path}`);
    return nodeFs().readFileSync(path, "utf-8");
  };
  const validation = validateManifest(JSON.parse(read("manifest.json", "manifest.json")));
  if (!validation.ok) throw new Error(`Template fixture "${id}": invalid manifest: ${validation.reason}`);
  const { manifest } = validation;

  const instructions = (declarations: readonly { type: string; agentsMd?: string }[] | undefined) => {
    const files: Record<string, string> = {};
    for (const declaration of declarations ?? []) {
      if (declaration.agentsMd) files[declaration.type] = read(declaration.agentsMd, declaration.agentsMd);
    }
    return Object.keys(files).length > 0 ? files : undefined;
  };
  const missionAgentsMd = instructions(manifest.missionTypes);
  const sourceInstructions = instructions(manifest.sources);
  const jobInstructions = instructions(manifest.jobTypes);
  return {
    manifest,
    agentsMd: read("AGENTS.md", "AGENTS.md"),
    ...(missionAgentsMd ? { missionAgentsMd } : {}),
    ...(sourceInstructions ? { sourceInstructions } : {}),
    ...(jobInstructions ? { jobInstructions } : {}),
  };
}

/**
 * Installs an in-memory Template registry seeded with `templates` for each of
 * `projectIds` (a Project is identified by its Instance id in Convex). Returns
 * the restore function to call in `afterEach`.
 */
export function installTemplateRegistry(projectIds: readonly ProjectId[], templates: readonly AgentTemplate[]): () => void {
  setTemplateRegistryForTests(inMemoryRegistry(projectIds, templates));
  return () => setTemplateRegistryForTests(undefined);
}
