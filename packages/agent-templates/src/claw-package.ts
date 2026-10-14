/**
 * Claw package → Agent Template adapter (issue #649, PRD #642).
 *
 * A Template is distributed as an OpenClaw Claw package. This module turns the
 * package's files into a validated `AgentTemplate`, as a pure function (files
 * in, Template or explicit error out — no I/O, so it runs in Convex).
 *
 * The package is a NATIVE OpenClaw Claw (`openclaw claws add` accepts it as is,
 * guarded by `claw-package-native.test.ts`); everything OpenGroow-specific rides
 * in `profiles/opengroow.yml`. Layout, relative to the package root:
 * - `package.json` — `name` is the Template id (scoped, e.g. `@acme/seo`: the
 *   native `agent.id` is a lowercase slug and cannot carry the scope) and
 *   `openclaw.claw` points at `CLAW.md`. `version` is read by the registry.
 * - `CLAW.md` — native frontmatter: `schemaVersion: 1`, `agent: { id, name,
 *   description }` (name and description are the Template's; `agent.id` is
 *   OpenClaw's slug, not read here), `workspace` (the files OpenClaw seeds,
 *   not read here: OpenGroow reads `workspace/` by convention) and `packages`
 *   (required skills, `{ kind: "skill", source: "clawhub", ref, version }`,
 *   the exact version being mandatory natively). The Markdown body is the
 *   portable prompt (OpenClaw's SOUL.md); OpenGroow does not read it.
 * - `workspace/` — `AGENTS.md` (base instructions) plus every instruction file
 *   the manifest references (Mission types, Sources, Jobs), at the same
 *   relative path the manifest declares.
 * - `profiles/opengroow.yml` — the rest of the manifest, as JSON-compatible YAML,
 *   plus `schemaVersion`. Validated by `validateManifest`, so unknown keys are
 *   refused (#644). Its `openclawProfile` carries what OpenClaw's native
 *   profile cannot (`execNode`).
 * - `profiles/openclaw.yml` — optional NATIVE OpenClaw agent profile
 *   (`schemaVersion: 1`, `agent.tools.deny`), merged into the Template's
 *   `openclawProfile` as `toolDeny` (#657, #663). Other native settings are
 *   refused rather than silently ignored.
 * - `plugins/<id>/` — optional OpenClaw plugins (#661), each a complete plugin
 *   folder. Not a native concept (native plugins are ClawHub `packages`, which
 *   OpenGroow refuses): OpenClaw ignores the folder, OpenGroow's reconciliation
 *   copies it into the Instance (see `template-plugins.ts`).
 *
 * `missionContract` is accepted in the profile and expanded here with
 * `expandManifestSource`: authors write a shared review / External Job /
 * generative-call contract once, but the Template OpenGroow stores and reads
 * always carries explicit per-Mission-type contracts (GLOSSARY.md). This keeps
 * packages free of a codegen step.
 */

import { type Document, isAlias, isMap, isNode, isScalar, parse, parseDocument, visit } from "yaml";
import { expandManifestSource, type ManifestSource } from "./expand-manifest-source";
import { validateManifest } from "./index";
import { collectTemplatePlugins } from "./template-plugins";
import type { AgentManifest, AgentTemplate, OpenClawProfile, TemplateSkillDeclaration } from "./types";

/** Files of a package, keyed by path relative to the package root (forward slashes). */
export type ClawPackageFiles = Record<string, string>;

export type ClawPackageResult =
  | { ok: true; template: AgentTemplate }
  | { ok: false; reason: string };

/** The profile schema version this deployment writes and reads. */
export const CURRENT_PROFILE_SCHEMA_VERSION = 1;
/**
 * Schema versions this deployment reads. The policy is the current one and the
 * previous one (N and N-1), but version 1 is the first: the first breaking
 * change (version 2) must add version 1's read path here.
 */
export const SUPPORTED_PROFILE_SCHEMA_VERSIONS: readonly number[] = [
  CURRENT_PROFILE_SCHEMA_VERSION,
];
/** Maximum size of `profiles/opengroow.yml`, per the OpenClaw profile rules. */
export const MAX_PROFILE_BYTES = 256 * 1024;

const CLAW_PATH = "CLAW.md";
const PACKAGE_JSON_PATH = "package.json";
const PROFILE_PATH = "profiles/opengroow.yml";
const OPENCLAW_PROFILE_PATH = "profiles/openclaw.yml";
const AGENTS_PATH = "workspace/AGENTS.md";

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

function readFrontmatter(source: string | undefined): Parsed<Record<string, unknown>> {
  if (source === undefined) return fail(`${CLAW_PATH} is missing`);
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) return fail(`${CLAW_PATH} must start with a YAML frontmatter block delimited by "---"`);
  let data: unknown;
  try {
    data = parse(match[1]!);
  } catch (error) {
    return fail(`${CLAW_PATH} frontmatter is not valid YAML: ${(error as Error).message}`);
  }
  if (!isRecord(data)) return fail(`${CLAW_PATH} frontmatter must be a mapping`);
  return { ok: true, value: data };
}

function requiredString(data: Record<string, unknown>, key: string, where: string): Parsed<string> {
  const value = data[key];
  if (typeof value !== "string" || value.length === 0) {
    return fail(`${where} is missing "${key}" (a non-empty string)`);
  }
  return { ok: true, value };
}

/** The Template id: the scoped `name` of the package's `package.json`. */
function readTemplateId(source: string | undefined): Parsed<string> {
  if (source === undefined) return fail(`${PACKAGE_JSON_PATH} is missing`);
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    return fail(`${PACKAGE_JSON_PATH} is not valid JSON`);
  }
  if (!isRecord(data)) return fail(`${PACKAGE_JSON_PATH} must be a JSON object`);
  return requiredString(data, "name", PACKAGE_JSON_PATH);
}

type Identity = { name: string; description: string };

/** The native `agent` block: the Template's name and description. */
function readAgent(front: Record<string, unknown>): Parsed<Identity> {
  if (front.schemaVersion !== 1) {
    return fail(`${CLAW_PATH} frontmatter must declare "schemaVersion: 1" (OpenClaw's Claw manifest version)`);
  }
  const agent = front.agent;
  if (!isRecord(agent)) return fail(`${CLAW_PATH} frontmatter is missing "agent" (a mapping with id, name and description)`);
  for (const key of ["id", "name", "description"]) {
    if (typeof agent[key] !== "string" || agent[key].length === 0) {
      return fail(`${CLAW_PATH} frontmatter is missing agent.${key} (a non-empty string)`);
    }
  }
  return { ok: true, value: { name: agent.name as string, description: agent.description as string } };
}

function readSkills(packages: unknown): Parsed<TemplateSkillDeclaration[]> {
  if (packages === undefined) return { ok: true, value: [] };
  if (!Array.isArray(packages)) return fail(`${CLAW_PATH} frontmatter "packages" must be a list`);
  const skills: TemplateSkillDeclaration[] = [];
  for (const [index, entry] of packages.entries()) {
    const at = `${CLAW_PATH} packages[${index}]`;
    if (!isRecord(entry) || entry.kind !== "skill") {
      const kind = isRecord(entry) ? JSON.stringify(entry.kind) : JSON.stringify(entry);
      return fail(`${at}: kind ${kind} is not supported — only "skill" packages are installed`);
    }
    if (entry.source !== "clawhub") return fail(`${at}: source ${JSON.stringify(entry.source)} is not supported — only "clawhub"`);
    const ref = requiredString(entry, "ref", at);
    if (!ref.ok) return ref;
    const version = requiredString(entry, "version", at);
    if (!version.ok) return version;
    skills.push({ source: "clawhub", spec: ref.value, version: version.value });
  }
  return { ok: true, value: skills };
}

/** Why a YAML node falls outside JSON's data model, or `undefined` when it is JSON-compatible. */
function nonJsonNodeProblem(node: unknown): string | undefined {
  if (isAlias(node)) return "uses an alias (*name); anchors and aliases are not allowed";
  if (!isNode(node)) return undefined;
  if (node.anchor) return `uses an anchor (&${node.anchor}); anchors and aliases are not allowed`;
  if (node.tag) return `uses a tag (${node.tag}), which is not allowed`;
  if (isScalar(node) && typeof node.value === "number" && !Number.isFinite(node.value)) {
    return `uses a non-finite number (${node.source ?? String(node.value)}), which JSON cannot represent`;
  }
  if (isMap(node)) {
    for (const pair of node.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string") {
        return `uses a non-string key (${String(pair.key)}); keys must be strings`;
      }
      if (pair.key.value === "<<") return 'uses a merge key ("<<"), which is not allowed';
    }
  }
  return undefined;
}

/** Refuses YAML features outside JSON's data model: anchors, aliases, tags, merge keys, non-string keys, non-finite numbers. */
function findNonJsonYaml(doc: Document.Parsed): string | undefined {
  let found: string | undefined;
  visit(doc, {
    Node(_key, node) {
      found = nonJsonNodeProblem(node);
      return found ? visit.BREAK : undefined;
    },
  });
  return found;
}

function readProfile(source: string | undefined, path: string = PROFILE_PATH): Parsed<Record<string, unknown>> {
  if (source === undefined) return fail(`${path} is missing`);
  const bytes = new TextEncoder().encode(source).length;
  if (bytes > MAX_PROFILE_BYTES) {
    return fail(`${path} is ${bytes} bytes, over the ${MAX_PROFILE_BYTES / 1024} KiB limit`);
  }
  const doc = parseDocument(source, { uniqueKeys: true });
  const error = doc.errors[0];
  if (error) return fail(`${path} is not valid YAML: ${error.message}`);
  const problem = findNonJsonYaml(doc);
  if (problem) return fail(`${path} ${problem}`);
  const data: unknown = doc.toJS();
  if (!isRecord(data)) return fail(`${path} must be a mapping at its root`);
  return { ok: true, value: data };
}

function checkSchemaVersion(version: unknown): string | undefined {
  const accepted = `OpenGroow reads schemaVersion ${SUPPORTED_PROFILE_SCHEMA_VERSIONS.join(" and ")}`;
  if (version === undefined) return `${PROFILE_PATH}: "schemaVersion" is missing; ${accepted}`;
  if (typeof version !== "number" || !SUPPORTED_PROFILE_SCHEMA_VERSIONS.includes(version)) {
    return `${PROFILE_PATH}: unsupported schemaVersion ${JSON.stringify(version)}; ${accepted}`;
  }
  return undefined;
}

const MISSION_CONTRACT_KEYS = ["review", "externalJobs", "generativeMcpCall"];

/**
 * `missionContract` is consumed by `expandManifestSource` before `validateManifest`
 * runs, so its shape is checked here: an unknown key would otherwise be dropped
 * silently, and a malformed `missionTypes` would throw instead of being refused.
 */
function checkMissionContract(profile: Record<string, unknown>): string | undefined {
  const contract = profile.missionContract;
  if (contract === undefined) return undefined;
  if (!isRecord(contract)) return `${PROFILE_PATH}: "missionContract" must be a mapping`;
  const unknown = Object.keys(contract).find((key) => !MISSION_CONTRACT_KEYS.includes(key));
  if (unknown !== undefined) {
    return `${PROFILE_PATH}: unknown key "${unknown}" at missionContract.${unknown} — expected one of ${MISSION_CONTRACT_KEYS.join(", ")}`;
  }
  if (contract.externalJobs !== undefined && !isRecord(contract.externalJobs)) {
    return `${PROFILE_PATH}: "missionContract.externalJobs" must be a mapping keyed by job type`;
  }
  const { missionTypes } = profile;
  if (missionTypes !== undefined && (!Array.isArray(missionTypes) || !missionTypes.every(isRecord))) {
    return `${PROFILE_PATH}: "missionTypes" must be a list of mappings`;
  }
  return undefined;
}

/** Native OpenClaw agent settings OpenGroow applies: only the tool deny list. */
function readNativeOpenclawProfile(source: string): Parsed<OpenClawProfile> {
  const read = readProfile(source, OPENCLAW_PROFILE_PATH);
  if (!read.ok) return read;
  const { schemaVersion, agent, ...topLevel } = read.value;
  const unknownTop = Object.keys(topLevel)[0];
  if (unknownTop !== undefined) {
    const legacy = unknownTop === "toolDeny" || unknownTop === "execNode";
    return fail(
      `${OPENCLAW_PROFILE_PATH}: "${unknownTop}" is ${
        legacy
          ? "not the native shape: use agent.tools.deny (execNode goes in profiles/opengroow.yml under openclawProfile)"
          : "not applied by OpenGroow"
      }`,
    );
  }
  if (schemaVersion !== 1) {
    return fail(`${OPENCLAW_PROFILE_PATH} must declare "schemaVersion: 1" (OpenClaw's native profile shape: agent.tools.deny)`);
  }
  if (agent === undefined) return { ok: true, value: {} };
  if (!isRecord(agent)) return fail(`${OPENCLAW_PROFILE_PATH}: "agent" must be a mapping`);
  const { tools, ...otherSettings } = agent;
  const otherKey = Object.keys(otherSettings)[0];
  if (otherKey !== undefined) return fail(`${OPENCLAW_PROFILE_PATH}: agent.${otherKey} is not applied by OpenGroow`);
  if (tools === undefined) return { ok: true, value: {} };
  if (!isRecord(tools)) return fail(`${OPENCLAW_PROFILE_PATH}: "agent.tools" must be a mapping`);
  const { deny, ...otherTools } = tools;
  const otherTool = Object.keys(otherTools)[0];
  if (otherTool !== undefined) return fail(`${OPENCLAW_PROFILE_PATH}: agent.tools.${otherTool} is not applied by OpenGroow`);
  if (deny === undefined) return { ok: true, value: {} };
  if (!Array.isArray(deny) || !deny.every((tool) => typeof tool === "string")) {
    return fail(`${OPENCLAW_PROFILE_PATH}: "agent.tools.deny" must be a list of tool names`);
  }
  return { ok: true, value: { toolDeny: deny as string[] } };
}

type InstructionRef = { label: string; path: string | undefined; key: string };

/** Every instruction file the manifest references, with the Template map it belongs to. */
function instructionRefs(manifest: AgentManifest) {
  const refs = (entries: Array<{ type: string; agentsMd?: string }> | undefined, label: string) =>
    (entries ?? []).map((entry): InstructionRef => ({ label: `${label} "${entry.type}"`, path: entry.agentsMd, key: entry.type }));
  return {
    missions: refs(manifest.missionTypes, "Mission type"),
    sources: refs(manifest.sources, "Source"),
    jobs: refs(manifest.jobTypes, "Job type"),
  };
}

function collectInstructions(
  files: ClawPackageFiles,
  refs: InstructionRef[],
): Parsed<Record<string, string> | undefined> {
  const collected: Record<string, string> = {};
  for (const ref of refs) {
    if (!ref.path) continue;
    const content = files[`workspace/${ref.path}`];
    if (content === undefined) {
      return fail(`${ref.label} declares agentsMd "${ref.path}" but the package has no workspace/${ref.path}`);
    }
    collected[ref.key] = content;
  }
  return { ok: true, value: Object.keys(collected).length > 0 ? collected : undefined };
}

export function clawPackageToTemplate(files: ClawPackageFiles): ClawPackageResult {
  const id = readTemplateId(files[PACKAGE_JSON_PATH]);
  if (!id.ok) return id;
  const front = readFrontmatter(files[CLAW_PATH]);
  if (!front.ok) return front;
  const identity = readAgent(front.value);
  if (!identity.ok) return identity;
  const skills = readSkills(front.value.packages);
  if (!skills.ok) return skills;

  const profile = readProfile(files[PROFILE_PATH]);
  if (!profile.ok) return profile;
  const { schemaVersion, ...rest } = profile.value;
  const versionProblem = checkSchemaVersion(schemaVersion);
  if (versionProblem) return fail(versionProblem);
  for (const key of ["id", "name", "description", "skills"]) {
    if (key in rest) {
      const home = key === "id" ? `the "name" of ${PACKAGE_JSON_PATH}` : CLAW_PATH;
      return fail(`${PROFILE_PATH}: "${key}" belongs in ${home}, not in the OpenGroow profile`);
    }
  }

  const openclawSource = files[OPENCLAW_PROFILE_PATH];
  if (openclawSource !== undefined) {
    const native = readNativeOpenclawProfile(openclawSource);
    if (!native.ok) return native;
    const declared = rest.openclawProfile;
    if (declared !== undefined && !isRecord(declared)) return fail(`${PROFILE_PATH}: "openclawProfile" must be a mapping`);
    if (native.value.toolDeny !== undefined && declared?.toolDeny !== undefined) {
      return fail(`${PROFILE_PATH}: "openclawProfile.toolDeny" is declared in both ${PROFILE_PATH} and ${OPENCLAW_PROFILE_PATH}; keep it in ${OPENCLAW_PROFILE_PATH}`);
    }
    const merged = { ...declared, ...native.value };
    if (Object.keys(merged).length > 0) rest.openclawProfile = merged;
  }

  const contractProblem = checkMissionContract(rest);
  if (contractProblem) return fail(contractProblem);
  const expanded = expandManifestSource(rest as ManifestSource);
  const validation = validateManifest({
    id: id.value,
    name: identity.value.name,
    description: identity.value.description,
    ...expanded,
    ...(skills.value.length > 0 ? { skills: skills.value } : {}),
  });
  if (!validation.ok) return fail(`${PROFILE_PATH}: ${validation.reason}`);
  const { manifest } = validation;

  const agentsMd = files[AGENTS_PATH];
  if (agentsMd === undefined) return fail(`${AGENTS_PATH} is missing`);

  const refs = instructionRefs(manifest);
  const missionAgentsMd = collectInstructions(files, refs.missions);
  if (!missionAgentsMd.ok) return missionAgentsMd;
  const sourceInstructions = collectInstructions(files, refs.sources);
  if (!sourceInstructions.ok) return sourceInstructions;
  const jobInstructions = collectInstructions(files, refs.jobs);
  if (!jobInstructions.ok) return jobInstructions;

  const plugins = collectTemplatePlugins(files);
  if (!plugins.ok) return fail(plugins.reason);

  return {
    ok: true,
    template: {
      manifest,
      agentsMd,
      ...(plugins.plugins.length > 0 ? { plugins: plugins.plugins } : {}),
      ...(missionAgentsMd.value ? { missionAgentsMd: missionAgentsMd.value } : {}),
      ...(sourceInstructions.value ? { sourceInstructions: sourceInstructions.value } : {}),
      ...(jobInstructions.value ? { jobInstructions: jobInstructions.value } : {}),
    },
  };
}
