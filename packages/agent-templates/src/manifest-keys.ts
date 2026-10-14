/**
 * Strict key check for Template manifests (issue #644). Every object of the
 * OpenGroow manifest vocabulary has a closed set of keys; anything else is
 * refused with the path of the offending key. This is what lets a manifest
 * version guarantee compatibility: a deployment too old for a package refuses
 * a newer field instead of silently ignoring it.
 *
 * Pure function over raw data. Shape and cross-reference validation stay in
 * `validateManifest`; this only answers "is every key known?". Free-form
 * subtrees are deliberately not walked: `analysisSchema` (JSON Schema, covered
 * by its own keyword allow-list), activation `body` trees, bounded HTTP effect
 * `body` templates, and maps keyed by user-chosen names (Mission types, job
 * types, Source ids, terminal-state lists).
 */

import { isPlainObject as isObj } from "./job-declarations";
import type {
  MachineToolInstall,
  MachineToolRequirement,
  MachineToolSource,
  MachineToolStep,
  MachineToolVersionCheck,
} from "./machine-tool";
import type {
  ActivationEffect,
  AgentBlocker,
  AgentManifest,
  BoundedHttpEffect,
  ExternalJobPollingContract,
  ExternalJobTerminalStateMap,
  JobTypeDeclaration,
  LeafRequirementField,
  MachineExternalPrerequisite,
  MachinePrerequisite,
  McpServerConfig,
  MissionPayloadField,
  MissionType,
  OpenClawProfile,
  RequirementField,
  RunContextDeclaration,
  ReviewActionCapability,
  ReviewActionInput,
  ReviewContentContract,
  RevisionRunEffect,
  SelectRequirementOption,
  SourceDeclaration,
  SourceExternalJobPollingContract,
  StatusCheckContract,
  TemplateSkillDeclaration,
} from "./types";

/** Every key of `T`, across all members of a union. */
type KeysOf<T> = T extends unknown ? keyof T & string : never;

/**
 * The closed key set of a manifest type. Typed against `T` so that adding or
 * removing a field in types.ts without updating the list here fails typecheck
 * (a missing key, or an excess one, is a compile error).
 */
const keySetOf = <T>(names: Record<KeysOf<T>, true>): Set<string> => new Set(Object.keys(names));

const MCP_SERVER = keySetOf<McpServerConfig>({
  name: true, transport: true, url: true, activationUrl: true, publicBaseUrl: true, headers: true, callTimeout: true,
});
const SELECT_OPTION = keySetOf<SelectRequirementOption>({ value: true, label: true });
const LEAF_REQUIREMENT = keySetOf<LeafRequirementField>({
  key: true, type: true, label: true, required: true, placeholder: true, defaultValue: true, immutable: true, deliveredToInstance: true, options: true,
});
const GROUP_REQUIREMENT = keySetOf<Extract<RequirementField, { type: "group" }>>({ type: true, label: true, fields: true });
const SKILL = keySetOf<TemplateSkillDeclaration>({ source: true, spec: true, version: true });
const MISSION_TYPE = keySetOf<MissionType>({
  type: true, label: true, description: true, payload: true, agentsMd: true, fields: true, sessionDurationMs: true,
  review: true, blockers: true, contextProviders: true,
});
const PAYLOAD_FIELD = keySetOf<MissionPayloadField>({
  key: true, label: true, required: true, type: true, options: true, min: true, max: true,
});
const SESSION_DURATION = keySetOf<NonNullable<MissionType["sessionDurationMs"]>>({ min: true, max: true });
const REVIEW = keySetOf<ReviewContentContract>({
  kind: true, service: true, server: true, path: true, coverPath: true, actions: true,
});
const REVIEW_ACTION = keySetOf<ReviewActionCapability>({
  key: true, label: true, requiredStatus: true, inputs: true, effect: true, transition: true,
});
const REVIEW_ACTION_INPUT = keySetOf<ReviewActionInput>({ key: true, label: true, type: true, required: true });
const HTTP_EFFECT = keySetOf<BoundedHttpEffect>({
  server: true, method: true, path: true, body: true, responseIndexingField: true,
});
const REVISION_EFFECT = keySetOf<RevisionRunEffect>({ kind: true, feedbackKey: true });
const BLOCKER = keySetOf<AgentBlocker>({ code: true, label: true, resolutionKind: true });
const MISSION_JOB = keySetOf<ExternalJobPollingContract>({
  server: true, mcpTool: true, statusField: true, terminalStates: true, outputIsRoot: true,
  resultIdField: true, resultStatus: true, artifactKind: true, onComplete: true, onFail: true,
});
const SOURCE_JOB = keySetOf<SourceExternalJobPollingContract>({
  server: true, mcpTool: true, statusField: true, terminalStates: true, outputIsRoot: true, unavailableErrorCodes: true,
});
const TERMINAL_STATES = keySetOf<ExternalJobTerminalStateMap>({ completed: true, failed: true });
const SOURCE = keySetOf<SourceDeclaration>({ type: true, label: true, family: true, agentsMd: true, analysisSchema: true });
const JOB_TYPE = keySetOf<JobTypeDeclaration>({ type: true, agentsMd: true, sourceTypes: true });
const GENERATIVE_CALL = keySetOf<NonNullable<AgentManifest["generativeMcpCall"]>[string]>({ toolName: true });
const ACTIVATION = keySetOf<ActivationEffect>({
  server: true, method: true, path: true, body: true, responseIdField: true, treatConflictAsExisting: true,
});
const STATUS_CHECK = keySetOf<StatusCheckContract>({ server: true, mcpTool: true });
const OPENCLAW_PROFILE = keySetOf<OpenClawProfile>({ toolDeny: true, execNode: true });
const MACHINE_PREREQUISITE = keySetOf<MachinePrerequisite>({ name: true, minVersion: true, instructionsUrl: true, installCommand: true, externalPrerequisites: true, install: true });
const MACHINE_EXTERNAL_PREREQUISITE = keySetOf<MachineExternalPrerequisite>({ name: true, instructionsUrl: true });
const MACHINE_TOOL_INSTALL = keySetOf<MachineToolInstall>({ id: true, source: true, requires: true, bootstrap: true, versionCheck: true });
const MACHINE_TOOL_SOURCE = keySetOf<MachineToolSource>({ url: true, sha256: true });
const MACHINE_TOOL_REQUIREMENT = keySetOf<MachineToolRequirement>({ name: true, check: true, instructionsUrl: true });
const MACHINE_TOOL_STEP = keySetOf<MachineToolStep>({ label: true, run: true });
const MACHINE_TOOL_VERSION_CHECK = keySetOf<MachineToolVersionCheck>({ run: true, pattern: true });
const RUN_CONTEXT = keySetOf<RunContextDeclaration>({ heading: true, lines: true });
const MANIFEST = keySetOf<AgentManifest>({
  id: true, name: true, description: true, category: true, mcpServers: true, contextProviders: true,
  requirements: true, skills: true, openclawProfile: true, machinePrerequisites: true, runContext: true, visibility: true, missionTypes: true, exclusiveResources: true, externalJobsByMissionType: true,
  sources: true, jobTypes: true, externalJobsBySource: true, generativeMcpCall: true, activation: true,
  reconfiguration: true, reconfigurable: true, statusCheck: true,
});

function machineToolKeyProblem(install: unknown, at: string): string | undefined {
  if (!isObj(install)) return undefined;
  return firstOf(
    () => unknownKeyIn(install, MACHINE_TOOL_INSTALL, at),
    () => unknownKeyIn(install.source, MACHINE_TOOL_SOURCE, `${at}.source`),
    () => eachItem(install.requires, `${at}.requires`, (item, p) => unknownKeyIn(item, MACHINE_TOOL_REQUIREMENT, p)),
    () => eachItem(install.bootstrap, `${at}.bootstrap`, (item, p) => unknownKeyIn(item, MACHINE_TOOL_STEP, p)),
    () => unknownKeyIn(install.versionCheck, MACHINE_TOOL_VERSION_CHECK, `${at}.versionCheck`),
  );
}

/** `a` + `.b`, or just `b` at the root. */
const dot = (path: string, key: string) => (path ? `${path}.${key}` : key);
const named = (path: string, name: string) => `${path}[${JSON.stringify(name)}]`;

/** The first unknown key of `value` (an object) against `allowed`, as a message. */
function unknownKeyIn(value: unknown, allowed: Set<string>, path: string): string | undefined {
  if (!isObj(value)) return undefined;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      return `unknown key "${key}" at ${dot(path, key)} — this OpenGroow manifest does not define it (a typo, or a field from a newer manifest version?)`;
    }
  }
  return undefined;
}

/** First message among `check(item, path)` over an array's entries; `label` names an entry. */
function eachItem(
  list: unknown,
  path: string,
  check: (item: unknown, itemPath: string) => string | undefined,
  label: (item: unknown, index: number) => string = (_item, index) => String(index),
): string | undefined {
  if (!Array.isArray(list)) return undefined;
  for (const [index, item] of list.entries()) {
    const found = check(item, `${path}[${label(item, index)}]`);
    if (found) return found;
  }
  return undefined;
}

/** First message among `check(value, path)` over an object's entries, keyed by their name. */
function eachEntry(
  map: unknown,
  path: string,
  check: (value: unknown, entryPath: string) => string | undefined,
): string | undefined {
  if (!isObj(map)) return undefined;
  for (const [name, value] of Object.entries(map)) {
    const found = check(value, named(path, name));
    if (found) return found;
  }
  return undefined;
}

/** First message among the given lazily evaluated checks. */
function firstOf(...checks: Array<() => string | undefined>): string | undefined {
  for (const check of checks) {
    const found = check();
    if (found) return found;
  }
  return undefined;
}

const byType = (item: unknown, index: number) =>
  isObj(item) && typeof item.type === "string" ? JSON.stringify(item.type) : String(index);

function checkOptions(options: unknown, path: string): string | undefined {
  return eachItem(options, path, (option, at) => unknownKeyIn(option, SELECT_OPTION, at));
}

function checkLeafRequirement(field: unknown, path: string): string | undefined {
  return firstOf(
    () => unknownKeyIn(field, LEAF_REQUIREMENT, path),
    () => (isObj(field) ? checkOptions(field.options, dot(path, "options")) : undefined),
  );
}

function checkRequirement(field: unknown, path: string): string | undefined {
  if (!isObj(field) || field.type !== "group") return checkLeafRequirement(field, path);
  return firstOf(
    () => unknownKeyIn(field, GROUP_REQUIREMENT, path),
    () => eachItem(field.fields, dot(path, "fields"), checkLeafRequirement),
  );
}

function checkReviewAction(action: unknown, path: string): string | undefined {
  if (!isObj(action)) return undefined;
  // Same discriminant as `isValidRevisionRunEffect`: only `kind: "revision_run"`
  // makes a RevisionRunEffect, so a stray `kind` on an HTTP effect is named as such.
  const effectKeys = isObj(action.effect) && action.effect.kind === "revision_run" ? REVISION_EFFECT : HTTP_EFFECT;
  return firstOf(
    () => unknownKeyIn(action, REVIEW_ACTION, path),
    () => eachItem(action.inputs, dot(path, "inputs"), (input, at) => unknownKeyIn(input, REVIEW_ACTION_INPUT, at)),
    () => unknownKeyIn(action.effect, effectKeys, dot(path, "effect")),
  );
}

function checkReview(review: unknown, path: string): string | undefined {
  return firstOf(
    () => unknownKeyIn(review, REVIEW, path),
    () => (isObj(review) ? eachItem(review.actions, dot(path, "actions"), checkReviewAction) : undefined),
  );
}

function checkMissionType(missionType: unknown, path: string): string | undefined {
  if (!isObj(missionType)) return undefined;
  return firstOf(
    () => unknownKeyIn(missionType, MISSION_TYPE, path),
    () =>
      eachItem(missionType.fields, dot(path, "fields"), (field, at) =>
        firstOf(
          () => unknownKeyIn(field, PAYLOAD_FIELD, at),
          () => (isObj(field) ? checkOptions(field.options, dot(at, "options")) : undefined),
        ),
      ),
    () => unknownKeyIn(missionType.sessionDurationMs, SESSION_DURATION, dot(path, "sessionDurationMs")),
    () => (missionType.review === undefined ? undefined : checkReview(missionType.review, dot(path, "review"))),
    () => eachItem(missionType.blockers, dot(path, "blockers"), (blocker, at) => unknownKeyIn(blocker, BLOCKER, at)),
  );
}

function checkJobContract(allowed: Set<string>) {
  return (contract: unknown, path: string): string | undefined =>
    firstOf(
      () => unknownKeyIn(contract, allowed, path),
      () => (isObj(contract) ? unknownKeyIn(contract.terminalStates, TERMINAL_STATES, dot(path, "terminalStates")) : undefined),
    );
}

const checkMissionJob = checkJobContract(MISSION_JOB);
const checkSourceJob = checkJobContract(SOURCE_JOB);

/**
 * Returns a message naming the first key of `manifest` (at any level of the
 * manifest vocabulary) that OpenGroow does not define, or undefined when every
 * key is known.
 */
export function findUnknownManifestKey(manifest: unknown): string | undefined {
  if (!isObj(manifest)) return undefined;
  return firstOf(
    () => unknownKeyIn(manifest, MANIFEST, ""),
    () => eachItem(manifest.mcpServers, "mcpServers", (server, at) => unknownKeyIn(server, MCP_SERVER, at)),
    () => eachItem(manifest.requirements, "requirements", checkRequirement),
    () => eachItem(manifest.skills, "skills", (skill, at) => unknownKeyIn(skill, SKILL, at)),
    () => eachItem(manifest.missionTypes, "missionTypes", checkMissionType, byType),
    () =>
      eachEntry(manifest.externalJobsByMissionType, "externalJobsByMissionType", (jobs, at) =>
        eachEntry(jobs, at, checkMissionJob),
      ),
    () => eachItem(manifest.sources, "sources", (source, at) => unknownKeyIn(source, SOURCE, at), byType),
    () => eachItem(manifest.jobTypes, "jobTypes", (job, at) => unknownKeyIn(job, JOB_TYPE, at), byType),
    () =>
      eachEntry(manifest.externalJobsBySource, "externalJobsBySource", (jobs, at) =>
        eachEntry(jobs, at, checkSourceJob),
      ),
    () => eachEntry(manifest.generativeMcpCall, "generativeMcpCall", (call, at) => unknownKeyIn(call, GENERATIVE_CALL, at)),
    () => unknownKeyIn(manifest.activation, ACTIVATION, "activation"),
    () => unknownKeyIn(manifest.reconfiguration, ACTIVATION, "reconfiguration"),
    () => unknownKeyIn(manifest.statusCheck, STATUS_CHECK, "statusCheck"),
    () => unknownKeyIn(manifest.openclawProfile, OPENCLAW_PROFILE, "openclawProfile"),
    () => eachItem(manifest.machinePrerequisites, "machinePrerequisites", (item, at) => firstOf(
      () => unknownKeyIn(item, MACHINE_PREREQUISITE, at),
      () => (isObj(item) ? eachItem(item.externalPrerequisites, `${at}.externalPrerequisites`, (ext, p) => unknownKeyIn(ext, MACHINE_EXTERNAL_PREREQUISITE, p)) : undefined),
      () => (isObj(item) ? machineToolKeyProblem(item.install, `${at}.install`) : undefined),
    )),
    () => unknownKeyIn(manifest.runContext, RUN_CONTEXT, "runContext"),
  );
}
