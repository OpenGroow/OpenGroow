import type { ActivationBodyNode, AgentManifest, AgentTemplate, McpServerConfig, RequirementField } from "./types";
import { machineToolInstallProblem } from "./machine-tool";
import { deriveConfigIdKey } from "./activation-engine";
import { flattenRequirementFields, labelTokenKeys } from "./requirements";
import { isValidExternalJobPollingCore, validateSourceDeclarations } from "./source-declarations";
import { validateJobTypeDeclarations } from "./job-declarations";
import { findUnknownManifestKey } from "./manifest-keys";
import { exclusiveResourcesProblem } from "./exclusive-resources";
import { validateRunContext } from "./run-context";

/**
 * Maximum length (in characters) of a Mission type `description`. The Source
 * Agent's routing reads these descriptions as data to pick a producer, so they
 * are bounded to keep a Template from smuggling long prompt-injection payloads
 * into routing. 500 fits a few sentences describing the deliverable.
 */
export const MAX_MISSION_TYPE_DESCRIPTION_LENGTH = 500;

/** Counts code points, so an emoji or accented character counts as one character. */
function exceedsMissionTypeDescriptionLimit(description: string): boolean {
  return [...description].length > MAX_MISSION_TYPE_DESCRIPTION_LENGTH;
}

export type {
  ActivationBodyNode,
  ActivationEffect,
  AgentBlocker,
  AgentManifest,
  AgentSkillSource,
  AgentTemplate,
  BoundedHttpEffect,
  BlockerResolutionKind,
  ConfigCompletenessStatus,
  ExternalJobHandoff,
  ExternalJobPollingContract,
  ExternalJobPollingCore,
  SourceExternalJobPollingContract,
  ExternalJobTerminalStateMap,
  McpClient,
  McpServerConfig,
  MissionType,
  RequirementField,
  ReviewActionCapability,
  ReviewActionInput,
  ReviewActionTransition,
  ReviewContentContract,
  RevisionRunEffect,
  SourceDeclaration,
  JobTypeDeclaration,
  JobTypeName,
  StatusCheckContract,
  TemplateSkillDeclaration,
  TemplatePlugin,
} from "./types";
export {
  clawPackageToTemplate,
  CURRENT_PROFILE_SCHEMA_VERSION,
  MAX_PROFILE_BYTES,
  SUPPORTED_PROFILE_SCHEMA_VERSIONS,
  type ClawPackageFiles,
  type ClawPackageResult,
} from "./claw-package";
export { OFFICIAL_SCOPE } from "./official-scope";
export { openClawAgentSlug } from "./openclaw-agent-slug";
export { executeActivationEffect } from "./execute-activation-effect";
export { deriveConfigIdKey };
export { deliveredRequirementField, flattenRequirementFields, hasRetryableStatusCheck } from "./requirements";
export {
  getRequiredTemplateSkills,
  reconcileTemplateSkillsMirror,
  skillKey,
  findSkillByKey,
  upsertSkillEntry,
  type AgentSkillOrigin,
  type AgentSkillStatus,
  type ProjectAgentSkill,
  type SkillInstallOutcome,
} from "./skills";
export { renderRunContext, singleLine, type RunContextInputs } from "./run-context";
export { outboundUrlProblem } from "./outbound-url";
export { scopeReservationProblem, type InstallOrigin } from "./scope-reservation";
export { interpolateReviewTemplate } from "./review-interpolation";
export { exclusiveResourcesOf } from "./exclusive-resources";
export {
  resolveBlocker,
  resolveReviewContract,
  templateSupportsAutoPublish,
} from "./review-contract";

/**
 * Resolves the External Job polling contract for a given (missionType, jobType)
 * pair. Looks up `manifest.externalJobsByMissionType[missionType][jobType]` —
 * the uniform map shape (ADR-026). There is no scalar/global fallback: every
 * Mission type declares its job contracts as a map keyed by job type, even
 * when it only has one job today.
 */
export function resolveExternalJobContract(
  manifest: AgentManifest,
  missionType: string,
  jobType: string | undefined,
): import("./types").ExternalJobPollingContract | undefined {
  if (jobType === undefined) return undefined;
  return manifest.externalJobsByMissionType?.[missionType]?.[jobType];
}


/** Bounded set of valid review content kinds (ADR-020); also the valid `ExternalJobPollingContract.artifactKind`s. */
const VALID_REVIEW_KINDS = new Set(["markdown", "metadata", "image", "video"]);
const VALID_BLOCKER_RESOLUTION_KINDS = new Set(["link", "execution_device"]);

/**
 * The context providers OpenGroow core defines (issues #429, #660). A Template
 * references them by name in `contextProviders` (Template-level or per Mission
 * type); a name outside this list is refused at manifest validation. The
 * renderers live with the dispatcher (apps/convex/mission_dispatcher/
 * context_providers.ts), whose registry is typed against this list.
 */
export const CONTEXT_PROVIDER_NAMES = ["active-agents", "observation-production-source", "platform-account"] as const;
export type ContextProviderName = (typeof CONTEXT_PROVIDER_NAMES)[number];

function unknownContextProvider(raw: unknown): string | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.find((name) => !(CONTEXT_PROVIDER_NAMES as readonly unknown[]).includes(name)) as string | undefined;
}

function unknownContextProviderReason(name: string, where: string): string {
  return `${where} references unknown context provider ${JSON.stringify(name)} — OpenGroow core defines: ${CONTEXT_PROVIDER_NAMES.join(", ")}`;
}

/**
 * Collect the `server` name from a BoundedHttpEffect, or undefined if this is
 * a RevisionRunEffect (which has no external server reference).
 */
function boundedHttpEffectServer(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const e = raw as Record<string, unknown>;
  if (e.kind === "revision_run") return undefined; // RevisionRunEffect — no server
  if (typeof e.server === "string") return e.server;
  return undefined;
}

/**
 * The Agent config key holding a platform's account handle, by convention:
 * `accountHandle` + the capitalized platform value (`accountHandleInstagram`,
 * `accountHandleTiktok`) — matching the requirement keys declared in
 * the Social Engagement package's manifest.
 *
 * Neither handle is individually required (issue #352 follow-up): the platform
 * is chosen per Mission, and an Agent may only ever run one of the two. The
 * requirement group's legend carries the "at least one" expectation, which the
 * requirement schema cannot express as a constraint; a Mission targeting a
 * platform whose handle is unset fails loudly at dispatch in
 * the `platform-account` context provider.
 */
function accountHandleConfigKey(platform: string): string {
  return `accountHandle${platform.charAt(0).toUpperCase()}${platform.slice(1)}`;
}

/**
 * The platforms the `platform-account` core context provider (#660) knows,
 * each paired with its display label and the Agent config key holding that
 * platform's account handle. A Template using the provider declares matching
 * `accountHandle<Platform>` requirements and a `platform` select field on its
 * Mission type; the provider reads this map, not the Template's manifest (no
 * Template content is compiled into the product, #674).
 */
export const SOCIAL_ENGAGEMENT_PLATFORMS: Record<string, { label: string; accountHandleKey: string }> = {
  instagram: { label: "Instagram", accountHandleKey: accountHandleConfigKey("instagram") },
  tiktok: { label: "TikTok", accountHandleKey: accountHandleConfigKey("tiktok") },
};

function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function isValidMcpServerConfig(raw: unknown): raw is McpServerConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const s = raw as Record<string, unknown>;
  return (
    typeof s.name === "string" &&
    typeof s.transport === "string" &&
    typeof s.url === "string" &&
    (s.activationUrl === undefined || typeof s.activationUrl === "string") &&
    (s.publicBaseUrl === undefined || typeof s.publicBaseUrl === "string") &&
    (s.headers === undefined ||
      (typeof s.headers === "object" &&
        !Array.isArray(s.headers) &&
        s.headers !== null &&
        Object.values(s.headers as Record<string, unknown>).every((v) => typeof v === "string"))) &&
    (s.callTimeout === undefined || typeof s.callTimeout === "number")
  );
}

function isValidBoundedHttpEffect(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const e = raw as Record<string, unknown>;
  if (
    typeof e.server !== "string" ||
    e.method !== "POST" ||
    typeof e.path !== "string"
  ) {
    return false;
  }
  if (e.body !== undefined) {
    if (typeof e.body !== "object" || Array.isArray(e.body) || e.body === null) return false;
    if (!Object.values(e.body as Record<string, unknown>).every((v) => typeof v === "string")) return false;
  }
  if (e.responseIndexingField !== undefined && typeof e.responseIndexingField !== "string") return false;
  return true;
}

function isValidReviewActionInput(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const i = raw as Record<string, unknown>;
  return (
    typeof i.key === "string" &&
    typeof i.label === "string" &&
    (i.type === "text" || i.type === "datetime-local") &&
    typeof i.required === "boolean"
  );
}

/**
 * A required OpenClaw Agent Skill declared by a Template's `skills[]` (issue #222).
 * MVP source support is ClawHub only; `spec` must be a non-blank string after trim
 * (never lowercased or otherwise normalized — the raw spec is passed to `openclaw
 * skills install` verbatim).
 */
function isValidTemplateSkillDeclaration(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const s = raw as Record<string, unknown>;
  const versionOk = s.version === undefined || (typeof s.version === "string" && s.version.trim().length > 0);
  return s.source === "clawhub" && typeof s.spec === "string" && s.spec.trim().length > 0 && versionOk;
}

function isValidRevisionRunEffect(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const e = raw as Record<string, unknown>;
  return e.kind === "revision_run" && typeof e.feedbackKey === "string" && e.feedbackKey.length > 0;
}

function isValidReviewActionEffect(raw: unknown): boolean {
  return isValidBoundedHttpEffect(raw) || isValidRevisionRunEffect(raw);
}

function isValidReviewActionCapability(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const a = raw as Record<string, unknown>;
  if (
    (a.key !== "approve" && a.key !== "publish" && a.key !== "reject") ||
    typeof a.label !== "string" ||
    (a.requiredStatus !== "to_validate" && a.requiredStatus !== "approved") ||
    (a.transition !== "approved" && a.transition !== "done" && a.transition !== "doing")
  ) {
    return false;
  }
  if (a.effect !== undefined && !isValidReviewActionEffect(a.effect)) return false;
  // A "doing" transition models a revision Run: it MUST be driven by a
  // revision_run effect, otherwise the action would flip the Mission back to
  // doing without re-dispatching the Agent with feedback.
  if (a.transition === "doing" && !isValidRevisionRunEffect(a.effect)) return false;
  if (a.inputs !== undefined) {
    if (!Array.isArray(a.inputs)) return false;
    if (!(a.inputs as unknown[]).every((inp) => isValidReviewActionInput(inp))) return false;
  }
  return true;
}

function isValidReviewContentContract(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  if (!VALID_REVIEW_KINDS.has(r.kind as string)) return false;
  // Workspace variant: service === "workspace", no server/path required.
  const isWorkspace = r.service === "workspace";
  if (!isWorkspace && (typeof r.server !== "string" || typeof r.path !== "string")) {
    return false;
  }
  if (r.coverPath !== undefined && typeof r.coverPath !== "string") return false;
  if (r.actions !== undefined) {
    if (!Array.isArray(r.actions)) return false;
    if (!(r.actions as unknown[]).every((a) => isValidReviewActionCapability(a))) return false;
  }
  return true;
}

function isValidExternalJobPollingContract(raw: unknown): boolean {
  if (!isValidExternalJobPollingCore(raw)) return false;
  const e = raw as Record<string, unknown>;
  if (
    (e.resultStatus !== "needs_human_review" && e.resultStatus !== "success") ||
    !VALID_REVIEW_KINDS.has(e.artifactKind as string) ||
    (e.onComplete !== "terminal" && e.onComplete !== "resume_mission")
  ) {
    return false;
  }
  if (e.onFail !== undefined && e.onFail !== "terminal" && e.onFail !== "resume_mission") return false;
  if (e.resultIdField !== undefined && typeof e.resultIdField !== "string") return false;
  return true;
}

/**
 * Validate a raw StatusCheckContract object (issue #320, ADR-034).
 * Shape only — the `declaredServers` cross-check happens at the call site,
 * same pattern as `isValidExternalJobPollingContract`.
 */
function isValidStatusCheckContract(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const s = raw as Record<string, unknown>;
  return typeof s.server === "string" && s.server.length > 0 && typeof s.mcpTool === "string" && s.mcpTool.length > 0;
}

/** Collect all {ref} tokens in a string. */
function collectRefs(s: string): string[] {
  const refs: string[] = [];
  for (const m of s.matchAll(/\{([^}]+)\}/g)) {
    refs.push(m[1]);
  }
  return refs;
}

/**
 * Collect all {ref} tokens in an ActivationBodyNode tree.
 */
function collectBodyRefs(node: unknown): string[] {
  if (typeof node === "string") return collectRefs(node);
  if (!node || typeof node !== "object" || Array.isArray(node)) return [];
  const refs: string[] = [];
  for (const value of Object.values(node as Record<string, unknown>)) {
    refs.push(...collectBodyRefs(value));
  }
  return refs;
}

/**
 * Detect a JSON array anywhere in an ActivationBodyNode tree. ADR-021 defines the
 * body as a tree of literals and `{ref}` leaves (scalars + objects); arrays are not
 * part of the contract and the interpolator would turn them into index-keyed objects,
 * so reject them at validation time rather than mis-serialize them at runtime.
 */
function bodyContainsArray(node: unknown): boolean {
  if (Array.isArray(node)) return true;
  if (!node || typeof node !== "object") return false;
  return Object.values(node as Record<string, unknown>).some((v) => bodyContainsArray(v));
}

/**
 * Validate an interpolation reference in an ActivationEffect.
 * Valid refs: `{key}` where key ∈ requirementKeys, or `{config.<key>}`, or `{responseId}`.
 */
function validateInterpolationRef(
  ref: string,
  requirementKeys: Set<string>,
  fieldName: string,
): string | null {
  if (ref === "responseId") return null; // always valid
  if (ref.startsWith("config.")) return null; // frozen config references always valid
  if (requirementKeys.has(ref)) return null;
  return `${fieldName} body contains interpolation reference "{${ref}}" which is not declared in requirements and is not "{responseId}" or "{config.<key>}"`;
}

/**
 * Validate a raw ActivationEffect object (ADR-021).
 * Returns true if valid, or a reason string if invalid.
 *
 * Validates:
 * - server/method/path/responseIdField presence and types
 * - server is declared in mcpServers
 * - all interpolation references in body are valid (requirements keys, {config.*}, or {responseId})
 * - for POST activation: a {responseId} leaf must exist in body to declare the id key
 */
function isValidActivationEffect(
  raw: unknown,
  declaredServers: Set<string>,
  requirementKeys: Set<string>,
  fieldName: string,
): true | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return `${fieldName} must be an object`;
  }
  const e = raw as Record<string, unknown>;
  if (typeof e.server !== "string" || !e.server) {
    return `${fieldName}.server must be a non-empty string`;
  }
  if (e.method !== "POST" && e.method !== "PATCH") {
    return `${fieldName}.method must be "POST" or "PATCH"`;
  }
  if (typeof e.path !== "string" || !e.path) {
    return `${fieldName}.path must be a non-empty string`;
  }
  if (typeof e.responseIdField !== "string" || !e.responseIdField) {
    return `${fieldName}.responseIdField must be a non-empty string`;
  }
  if (!declaredServers.has(e.server)) {
    return `${fieldName}.server "${e.server}" is not declared in this Agent Template's mcpServers — add "${e.server}" to mcpServers or use a server name already declared`;
  }
  // Validate all interpolation references in body.
  if (e.body !== undefined) {
    if (bodyContainsArray(e.body)) {
      return `${fieldName}.body contains a JSON array — ADR-021 bodies are a tree of literals and "{ref}" leaves; arrays are not supported`;
    }
    const bodyRefs = collectBodyRefs(e.body);
    for (const ref of bodyRefs) {
      const err = validateInterpolationRef(ref, requirementKeys, fieldName);
      if (err !== null) return err;
    }
  }
  // POST activation must carry a bare `{responseId}` leaf so a frozen config id key
  // can be derived (ADR-021, point 3) — otherwise activation persists no stable id
  // and re-provisions on every run. PATCH (reconfiguration) needs no new id.
  if (e.method === "POST" && deriveConfigIdKey(e.body as ActivationBodyNode | undefined) === undefined) {
    return `${fieldName}.body must include a bare "{responseId}" leaf for POST activation so the frozen config id key can be derived`;
  }
  // Also validate {config.*} refs in path.
  const pathRefs = collectRefs(e.path);
  for (const ref of pathRefs) {
    if (!ref.startsWith("config.")) {
      return `${fieldName}.path contains reference "{${ref}}" — path references must use "{config.<key>}" form`;
    }
  }
  return true;
}

/**
 * Validate a raw manifest object and return either `{ ok: true, manifest }` or
 * `{ ok: false, reason }` with an actionable, domain-term failure message.
 *
 * All server name references in `review.server`, `review.actions[].effect.server`
 * (BoundedHttpEffect), and `externalJob.server` MUST resolve to a name declared
 * in the Template's own `mcpServers` array — no unknown external servers are allowed.
 */
export function validateManifest(raw: unknown): { ok: true; manifest: AgentManifest } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "manifest must be an object" };
  }
  const m = raw as Record<string, unknown>;

  if (typeof m.id !== "string" || !m.id) return { ok: false, reason: "missing or invalid 'id'" };
  if (typeof m.name !== "string" || !m.name) return { ok: false, reason: "missing or invalid 'name'" };
  if (typeof m.description !== "string") return { ok: false, reason: "missing or invalid 'description'" };
  if (typeof m.category !== "string") return { ok: false, reason: "missing or invalid 'category'" };
  if (!Array.isArray(m.mcpServers)) return { ok: false, reason: "'mcpServers' must be an array" };
  if (!(m.mcpServers as unknown[]).every((s) => isValidMcpServerConfig(s))) {
    return { ok: false, reason: "one or more entries in 'mcpServers' have invalid or missing fields (required: name, transport, url)" };
  }

  const visibility = m.visibility;
  if (visibility !== undefined && visibility !== "production" && visibility !== "development") {
    return { ok: false, reason: `invalid 'visibility' value ${JSON.stringify(visibility)} — must be "production" or "development"` };
  }

  const requirements = m.requirements;
  if (requirements !== undefined) {
    if (!Array.isArray(requirements) || !requirements.every((field) => isValidRequirementField(field))) {
      return { ok: false, reason: "one or more entries in 'requirements' have invalid type or missing fields" };
    }
    const delivered = flattenRequirementFields(requirements as RequirementField[]).filter((field) => field.deliveredToInstance);
    if (delivered.length > 1) {
      return { ok: false, reason: "at most one requirement may be 'deliveredToInstance': the Instance has a single delivery channel" };
    }
  }

  const missionTypes = m.missionTypes;
  if (missionTypes !== undefined) {
    if (!isValidMissionTypes(missionTypes)) {
      return { ok: false, reason: "one or more entries in 'missionTypes' have invalid shape — each must have type (non-empty string), label (non-empty string), payload (string), and agentsMd (safe relative .md path)" };
    }
    const validatedMissionTypes = missionTypes as Array<Record<string, unknown>>;
    for (const entry of validatedMissionTypes) {
      if (typeof entry.description === "string" && exceedsMissionTypeDescriptionLimit(entry.description)) {
        return {
          ok: false,
          reason: `missionTypes[${JSON.stringify(entry.type)}].description exceeds ${MAX_MISSION_TYPE_DESCRIPTION_LENGTH} characters`,
        };
      }
    }
    // A Mission type without its own description is routed on the Template-level description instead.
    if (validatedMissionTypes.some((entry) => entry.description === undefined) && exceedsMissionTypeDescriptionLimit(m.description)) {
      return {
        ok: false,
        reason: `'description' exceeds ${MAX_MISSION_TYPE_DESCRIPTION_LENGTH} characters but is the routing description of a Mission type without its own description`,
      };
    }
    if (
      validatedMissionTypes.length > 0 &&
      validatedMissionTypes.some((entry) => !entry.agentsMd)
    ) {
      return {
        ok: false,
        reason: "every entry in 'missionTypes' must declare agentsMd",
      };
    }
    const missionTypeIds = validatedMissionTypes.map((entry) => entry.type as string);
    if (new Set(missionTypeIds).size !== missionTypeIds.length) {
      return {
        ok: false,
        reason: "every entry in 'missionTypes' must declare a unique type",
      };
    }
    const instructionPaths = validatedMissionTypes.map((entry) => entry.agentsMd as string);
    if (new Set(instructionPaths).size !== instructionPaths.length) {
      return {
        ok: false,
        reason: "every entry in 'missionTypes' must declare its own unique agentsMd path",
      };
    }
  }

  if (m.exclusiveResources !== undefined) {
    const problem = exclusiveResourcesProblem(m.exclusiveResources, missionTypes);
    if (problem) return { ok: false, reason: problem };
  }

  const hasTypedMissionContracts =
    m.review !== undefined ||
    m.reviewByMissionType !== undefined ||
    m.externalJobsByMissionType !== undefined ||
    m.blockers !== undefined;
  if (hasTypedMissionContracts && !Array.isArray(missionTypes)) {
    return {
      ok: false,
      reason: "missionTypes is required when a manifest declares review, external job, or blocker contracts",
    };
  }
  const missionTypeNames = new Set(
    (Array.isArray(missionTypes) ? missionTypes : []).map(
      (entry) => (entry as Record<string, unknown>).type as string,
    ),
  );

  if (m.sessionDurationMs !== undefined) {
    return {
      ok: false,
      reason: "'sessionDurationMs' must be declared inside the matching 'missionTypes' entry, not at manifest level",
    };
  }

  const skills = m.skills;
  if (skills !== undefined) {
    if (!Array.isArray(skills) || !skills.every((s) => isValidTemplateSkillDeclaration(s))) {
      return {
        ok: false,
        reason: "one or more entries in 'skills' have invalid shape — each must have source: \"clawhub\" and a non-blank spec (string)",
      };
    }
  }

  if (m.openclawProfile !== undefined && !isValidOpenClawProfile(m.openclawProfile)) {
    return {
      ok: false,
      reason: "'openclawProfile' must be an object whose 'toolDeny' is an array of non-empty strings and whose 'execNode' is a non-blank string",
    };
  }

  if (m.machinePrerequisites !== undefined) {
    const problem = machinePrerequisitesProblem(m.machinePrerequisites);
    if (problem) return { ok: false, reason: problem };
  }

  if (m.runContext !== undefined) {
    const problem = validateRunContext(m.runContext, { requirements, missionTypes });
    if (problem) return { ok: false, reason: problem };
  }

  if (m.contextProviders !== undefined && !isNonBlankStringList(m.contextProviders)) {
    return {
      ok: false,
      reason: "'contextProviders' must be an array of non-empty strings",
    };
  }
  const unknownProvider = unknownContextProvider(m.contextProviders);
  if (unknownProvider !== undefined) {
    return { ok: false, reason: unknownContextProviderReason(unknownProvider, "'contextProviders'") };
  }
  for (const entry of (missionTypes ?? []) as Array<Record<string, unknown>>) {
    const unknownAtMissionType = unknownContextProvider(entry.contextProviders);
    if (unknownAtMissionType !== undefined) {
      return {
        ok: false,
        reason: unknownContextProviderReason(unknownAtMissionType, `missionTypes[${JSON.stringify(entry.type)}].contextProviders`),
      };
    }
  }

  // Collect declared MCP server names for cross-validation below.
  const declaredServers = new Set(
    (m.mcpServers as Array<{ name: string }>).map((s) => s.name),
  );

  // Collect all requirement leaf keys for interpolation-reference validation.
  const requirementKeys = new Set<string>();
  if (Array.isArray(requirements)) {
    for (const field of requirements as Array<Record<string, unknown>>) {
      if (field.type === "group" && Array.isArray(field.fields)) {
        for (const leaf of field.fields as Array<Record<string, unknown>>) {
          if (typeof leaf.key === "string") requirementKeys.add(leaf.key);
        }
      } else if (typeof field.key === "string") {
        requirementKeys.add(field.key);
      }
    }
  }

  // A requirement's `label` may reference a sibling field with a `({key})`
  // token (e.g. "Account handle ({platform})", issue #345) — the dashboard's
  // ActivationDialog resolves it against that sibling's current value with
  // `resolveLabelTokens`, over the same grammar `labelTokenKeys` parses here.
  // Catch a typo'd or dangling reference now, the same way interpolation refs
  // in activation effects are validated below, instead of letting it silently
  // degrade to a dropped "(...)" group at render time.
  if (Array.isArray(requirements)) {
    for (const field of requirements as Array<Record<string, unknown>>) {
      const leaves = field.type === "group" && Array.isArray(field.fields) ? (field.fields as Array<Record<string, unknown>>) : [field];
      for (const leaf of leaves) {
        const label = leaf.label;
        if (typeof label !== "string") continue;
        for (const ref of labelTokenKeys(label)) {
          if (!requirementKeys.has(ref)) {
            return {
              ok: false,
              reason: `requirements[key=${JSON.stringify(leaf.key)}].label references "({${ref}})", which is not a declared requirement key`,
            };
          }
        }
      }
    }
  }

  if (m.review !== undefined) {
    return {
      ok: false,
      reason: "'review' is no longer a valid manifest field — declare it inside the matching 'missionTypes' entry",
    };
  }

  if (m.reviewByMissionType !== undefined) {
    return {
      ok: false,
      reason: "'reviewByMissionType' is no longer a valid manifest field — declare 'review' inside the matching 'missionTypes' entry",
    };
  }

  if (m.blockers !== undefined) {
    return {
      ok: false,
      reason: "'blockers' is no longer a valid manifest field — declare 'blockers' inside the matching 'missionTypes' entry",
    };
  }

  // Validate Mission-type-owned review and blocker contracts.
  for (const missionType of (missionTypes as Array<Record<string, unknown>> | undefined) ?? []) {
    const missionTypeName = missionType.type as string;
    const review = missionType.review;
    if (review !== undefined) {
      if (!isValidReviewContentContract(review)) {
        if (review && typeof review === "object" && !Array.isArray(review)) {
          const malformed = review as Record<string, unknown>;
          if (!VALID_REVIEW_KINDS.has(malformed.kind as string)) {
            return {
              ok: false,
              reason: `missionTypes[${JSON.stringify(missionTypeName)}].review.kind ${JSON.stringify(malformed.kind)} is not a valid Artifact content kind — must be one of: markdown, metadata, image, video`,
            };
          }
        }
        return {
          ok: false,
          reason: `missionTypes[${JSON.stringify(missionTypeName)}].review is malformed — required fields: kind ∈ {markdown,metadata,image,video}, server (string), path (string)`,
        };
      }
      const reviewRecord = review as Record<string, unknown>;
      if (reviewRecord.service !== "workspace") {
        const reviewServer = reviewRecord.server as string;
        if (!declaredServers.has(reviewServer)) {
          return {
            ok: false,
            reason: `missionTypes[${JSON.stringify(missionTypeName)}].review.server "${reviewServer}" is not declared in this Agent Template's mcpServers`,
          };
        }
      }
      for (const action of ((reviewRecord.actions as unknown[] | undefined) ?? [])) {
        const effectServer = boundedHttpEffectServer((action as Record<string, unknown>).effect);
        if (effectServer !== undefined && !declaredServers.has(effectServer)) {
          return {
            ok: false,
            reason: `missionTypes[${JSON.stringify(missionTypeName)}].review.actions[key=${JSON.stringify((action as Record<string, unknown>).key)}].effect.server "${effectServer}" is not declared in mcpServers`,
          };
        }
      }
    }

    const blockers = missionType.blockers;
    if (blockers !== undefined) {
      if (!Array.isArray(blockers)) {
        return { ok: false, reason: `missionTypes[${JSON.stringify(missionTypeName)}].blockers must be an array of { code, label, resolutionKind } entries` };
      }
      const blockerCodes = new Set<string>();
      for (const blocker of blockers) {
        if (!blocker || typeof blocker !== "object" || Array.isArray(blocker)) {
          return { ok: false, reason: `missionTypes[${JSON.stringify(missionTypeName)}].blockers entries must be objects with code, label, and resolutionKind` };
        }
        const b = blocker as Record<string, unknown>;
        if (typeof b.code !== "string" || b.code.length === 0 || typeof b.label !== "string" || b.label.length === 0) {
          return { ok: false, reason: `missionTypes[${JSON.stringify(missionTypeName)}].blockers entries require non-empty code and label strings` };
        }
        if (!VALID_BLOCKER_RESOLUTION_KINDS.has(b.resolutionKind as string)) {
          return {
            ok: false,
            reason: `missionTypes[${JSON.stringify(missionTypeName)}].blocker "${b.code}" has invalid resolutionKind ${JSON.stringify(b.resolutionKind)} — must be one of: link, execution_device`,
          };
        }
        if (blockerCodes.has(b.code)) {
          return { ok: false, reason: `missionTypes[${JSON.stringify(missionTypeName)}].blockers contains duplicate code "${b.code}"` };
        }
        blockerCodes.add(b.code);
      }
    }
  }

  // Reject the pre-ADR-026 scalar shapes: ADR-026 renamed `externalJobByMissionType`
  // to `externalJobsByMissionType` and dropped the `externalJob` default entirely, so
  // no Mission type may keep the old scalar form. A manifest still carrying either
  // legacy field would otherwise pass validation and silently fail at poll time
  // (resolveExternalJobContract only reads the new map).
  if (m.externalJob !== undefined) {
    return {
      ok: false,
      reason: "'externalJob' is no longer a valid manifest field — ADR-026 replaced it with 'externalJobsByMissionType', a map of mission type to job type to ExternalJobPollingContract",
    };
  }
  if (m.externalJobByMissionType !== undefined) {
    return {
      ok: false,
      reason: "'externalJobByMissionType' is no longer a valid manifest field — ADR-026 renamed it to 'externalJobsByMissionType' and requires a map of job type to ExternalJobPollingContract for each mission type",
    };
  }

  // Validate externalJobsByMissionType entries: a map of mission type to a map
  // of job type (MCP tool name) to ExternalJobPollingContract (ADR-026).
  if (m.externalJobsByMissionType !== undefined) {
    if (typeof m.externalJobsByMissionType !== "object" || Array.isArray(m.externalJobsByMissionType)) {
      return { ok: false, reason: "externalJobsByMissionType must be an object mapping mission type strings to a map of job type to ExternalJobPollingContract" };
    }
    for (const [missionType, jobsByType] of Object.entries(m.externalJobsByMissionType as Record<string, unknown>)) {
      if (!missionTypeNames.has(missionType)) {
        return {
          ok: false,
          reason: `externalJobsByMissionType contains unknown Mission type "${missionType}" — add it to missionTypes`,
        };
      }
      if (!jobsByType || typeof jobsByType !== "object" || Array.isArray(jobsByType)) {
        return {
          ok: false,
          reason: `externalJobsByMissionType["${missionType}"] must be an object mapping job type strings to ExternalJobPollingContract`,
        };
      }
      for (const [jobType, contract] of Object.entries(jobsByType as Record<string, unknown>)) {
        if (!isValidExternalJobPollingContract(contract)) {
          // Guard the shape before reading fields so a null/non-object contract
          // returns the generic reason instead of throwing here.
          if (contract && typeof contract === "object" && !Array.isArray(contract)) {
            const e = contract as Record<string, unknown>;
            if (e.artifactKind !== undefined && !VALID_REVIEW_KINDS.has(e.artifactKind as string)) {
              return {
                ok: false,
                reason: `externalJobsByMissionType["${missionType}"]["${jobType}"].artifactKind ${JSON.stringify(e.artifactKind)} is not valid — must be one of: ${[...VALID_REVIEW_KINDS].join(", ")}`,
              };
            }
          }
          return {
            ok: false,
            reason: `externalJobsByMissionType["${missionType}"]["${jobType}"] is malformed — required fields: server (string), mcpTool (string), statusField (string), terminalStates.completed (string[]), terminalStates.failed (string[]), resultStatus ∈ {needs_human_review,success}, artifactKind ∈ {${[...VALID_REVIEW_KINDS].join(",")}}, onComplete ∈ {terminal,resume_mission}; optional onFail ∈ {terminal,resume_mission}`,
          };
        }
        const c = contract as Record<string, unknown>;
        if (!declaredServers.has(c.server as string)) {
          return {
            ok: false,
            reason: `externalJobsByMissionType["${missionType}"]["${jobType}"].server "${c.server}" is not declared in this Agent Template's mcpServers`,
          };
        }
      }
    }
  }

  const missionAgentsMd = new Map<string, string>();
  if (Array.isArray(m.missionTypes)) {
    for (const entry of m.missionTypes as Array<Record<string, unknown>>) {
      if (typeof entry.agentsMd === "string" && typeof entry.type === "string") {
        missionAgentsMd.set(entry.agentsMd, entry.type);
      }
    }
  }
  const jobReason = validateJobTypeDeclarations(m, isValidMissionAgentsMdPath, missionAgentsMd);
  if (jobReason) return { ok: false, reason: jobReason };
  const sourcesReason = validateSourceDeclarations(m, declaredServers, isValidMissionAgentsMdPath, missionAgentsMd);
  if (sourcesReason) return { ok: false, reason: sourcesReason };

  // Validate generativeMcpCall entries: a map of mission type to the name of
  // the MCP tool that produces this Mission type's deliverable content (ADR-050).
  // This is a declarative switch only — it does not verify the tool's output
  // shape, only that a Run of this Mission type is worth surfacing a
  // "Génération" prompt panel for.
  if (m.generativeMcpCall !== undefined) {
    if (!isPlainObject(m.generativeMcpCall)) {
      return { ok: false, reason: "generativeMcpCall must be an object mapping mission type strings to { toolName: string }" };
    }
    // Hoisted out of the loop below: `m.externalJobsByMissionType` doesn't
    // change per mission type, only the lookup into it does.
    const externalJobsByMissionType = isPlainObject(m.externalJobsByMissionType) ? m.externalJobsByMissionType : undefined;
    for (const [missionType, entry] of Object.entries(m.generativeMcpCall)) {
      if (!missionTypeNames.has(missionType)) {
        return {
          ok: false,
          reason: `generativeMcpCall contains unknown Mission type "${missionType}" — add it to missionTypes`,
        };
      }
      if (!isPlainObject(entry) || typeof entry.toolName !== "string" || entry.toolName === "") {
        return {
          ok: false,
          reason: `generativeMcpCall["${missionType}"] is malformed — required field: toolName (non-empty string)`,
        };
      }
      // ADR-050's altitude review: without this check, renaming a job type in
      // externalJobsByMissionType can silently strand generativeMcpCall
      // pointing at a tool that no longer resolves, with nothing catching the
      // drift. Only enforced when this Mission type declares External Jobs at
      // all — a Template may have a synchronous generative call with no job
      // polling contract to cross-check against.
      const jobsForType = externalJobsByMissionType?.[missionType];
      if (isPlainObject(jobsForType) && !(entry.toolName in jobsForType)) {
        return {
          ok: false,
          reason: `generativeMcpCall["${missionType}"].toolName "${entry.toolName}" is not a job type declared in externalJobsByMissionType["${missionType}"] — keep them in sync`,
        };
      }
    }
  }

  // Validate the statusCheck contract (issue #320, ADR-034). Activation and
  // reconfiguration effects remain optional and are validated independently
  // below — a Template may declare statusCheck instead of, or alongside,
  // either of them.
  if (m.statusCheck !== undefined) {
    if (!isValidStatusCheckContract(m.statusCheck)) {
      return {
        ok: false,
        reason: "statusCheck is malformed — required fields: server (string), mcpTool (string)",
      };
    }
    const sc = m.statusCheck as Record<string, unknown>;
    if (!declaredServers.has(sc.server as string)) {
      return {
        ok: false,
        reason: `statusCheck.server "${sc.server}" is not declared in this Agent Template's mcpServers — add "${sc.server}" to mcpServers or use a server name already declared`,
      };
    }
  }

  // Validate activation and reconfiguration effects.
  for (const effectKey of ["activation", "reconfiguration"] as const) {
    if (m[effectKey] !== undefined) {
      const activationValidationResult = isValidActivationEffect(m[effectKey], declaredServers, requirementKeys, effectKey);
      if (activationValidationResult !== true) {
        return { ok: false, reason: activationValidationResult };
      }
    }
  }

  // Strict keys (issue #644): last, so the targeted legacy-field and shape
  // messages above win; every key that survives them must still be known.
  const unknownKey = findUnknownManifestKey(m);
  if (unknownKey) return { ok: false, reason: unknownKey };

  return { ok: true, manifest: m as AgentManifest };
}

function isValidLeafField(raw: Record<string, unknown>): boolean {
  return (
    typeof raw.key === "string" &&
    (raw.type === "text" ||
      raw.type === "password" ||
      raw.type === "url" ||
      raw.type === "textarea" ||
      (raw.type === "select" && isValidSelectOptions(raw.options))) &&
    typeof raw.label === "string" &&
    typeof raw.required === "boolean" &&
    (raw.placeholder === undefined || typeof raw.placeholder === "string") &&
    (raw.defaultValue === undefined || typeof raw.defaultValue === "string") &&
    (raw.immutable === undefined || typeof raw.immutable === "boolean") &&
    (raw.deliveredToInstance === undefined || typeof raw.deliveredToInstance === "boolean")
  );
}

function isValidSelectOptions(raw: unknown): boolean {
  return (
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw.every((option) => {
      if (!option || typeof option !== "object") return false;
      const record = option as Record<string, unknown>;
      return typeof record.value === "string" && typeof record.label === "string";
    })
  );
}

/** `npm install -g <package>[@version]`: one package, no shell syntax, so what is copied is what runs. */
const NPM_INSTALL_COMMAND = /^npm (?:install|i) -g (?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*(?:@[a-z0-9][a-z0-9._-]*)?$/;

function machinePrerequisitesProblem(raw: unknown): string | undefined {
  if (!Array.isArray(raw)) return "'machinePrerequisites' must be an array";
  for (const [index, entry] of raw.entries()) {
    const at = `machinePrerequisites[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return `${at} must be an object`;
    const { name, minVersion, instructionsUrl } = entry as Record<string, unknown>;
    if (typeof name !== "string" || name.trim().length === 0) return `${at}.name must be a non-blank string`;
    if (minVersion !== undefined && (typeof minVersion !== "string" || minVersion.trim().length === 0)) {
      return `${at}.minVersion must be a non-blank string when present`;
    }
    if (typeof instructionsUrl !== "string" || !/^https?:\/\/\S+$/.test(instructionsUrl)) {
      return `${at}.instructionsUrl must be an http(s) URL`;
    }
    const { installCommand, externalPrerequisites } = entry as Record<string, unknown>;
    if (installCommand !== undefined && (typeof installCommand !== "string" || !NPM_INSTALL_COMMAND.test(installCommand))) {
      return `${at}.installCommand must be an npm global install of one package (e.g. "npm install -g @scope/name")`;
    }
    if (externalPrerequisites !== undefined) {
      if (!Array.isArray(externalPrerequisites)) return `${at}.externalPrerequisites must be an array`;
      for (const [i, ext] of externalPrerequisites.entries()) {
        const eat = `${at}.externalPrerequisites[${i}]`;
        if (!ext || typeof ext !== "object" || Array.isArray(ext)) return `${eat} must be an object`;
        const { name: extName, instructionsUrl: extUrl } = ext as Record<string, unknown>;
        if (typeof extName !== "string" || extName.trim().length === 0) return `${eat}.name must be a non-blank string`;
        if (typeof extUrl !== "string" || !/^https?:\/\/\S+$/.test(extUrl)) return `${eat}.instructionsUrl must be an http(s) URL`;
      }
    }
    const { install } = entry as Record<string, unknown>;
    if (install !== undefined) {
      const problem = machineToolInstallProblem(install, `${at}.install`, minVersion as string | undefined);
      if (problem) return problem;
    }
  }
  return undefined;
}

function isValidOpenClawProfile(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const p = raw as Record<string, unknown>;
  return (
    (p.toolDeny === undefined || isNonBlankStringList(p.toolDeny)) &&
    (p.execNode === undefined || (typeof p.execNode === "string" && p.execNode.trim().length > 0))
  );
}

function isNonBlankStringList(raw: unknown): boolean {
  return Array.isArray(raw) && raw.every((p) => typeof p === "string" && p.trim().length > 0);
}

function isValidMissionType(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const m = raw as Record<string, unknown>;
  return (
    typeof m.type === "string" && m.type.length > 0 &&
    typeof m.label === "string" && m.label.length > 0 &&
    (m.description === undefined || (typeof m.description === "string" && m.description.trim().length > 0)) &&
    typeof m.payload === "string" &&
    (m.agentsMd === undefined || isValidMissionAgentsMdPath(m.agentsMd)) &&
    (m.sessionDurationMs === undefined || isValidSessionDuration(m.sessionDurationMs)) &&
    (m.contextProviders === undefined || isNonBlankStringList(m.contextProviders))
  );
}

function isValidMissionAgentsMdPath(raw: unknown): raw is string {
  if (typeof raw !== "string" || !raw.endsWith(".md")) return false;
  if (raw !== raw.trim() || raw.startsWith("/") || raw.includes("\\") || raw.includes("\0")) return false;
  const segments = raw.split("/");
  const reservedRoots = new Set([".git", "memory", "missions", "node_modules", "skills"]);
  const reservedRootFiles = new Set([
    "agents.md",
    "boot.md",
    "bootstrap.md",
    "heartbeat.md",
    "identity.md",
    "memory.md",
    "soul.md",
    "user.md",
  ]);
  const fileName = segments.at(-1)?.toLowerCase() ?? "";
  return (
    segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..") &&
    !reservedRoots.has(segments[0]!.toLowerCase()) &&
    fileName !== "tools.md" &&
    !(segments.length === 1 && reservedRootFiles.has(fileName))
  );
}

function isValidSessionDuration(raw: unknown): raw is { min: number; max: number } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const duration = raw as Record<string, unknown>;
  return (
    typeof duration.min === "number" && Number.isFinite(duration.min) && duration.min > 0 &&
    typeof duration.max === "number" && Number.isFinite(duration.max) && duration.max >= duration.min
  );
}

function isValidMissionTypes(raw: unknown): boolean {
  if (!Array.isArray(raw)) return false;
  return raw.every((entry) => isValidMissionType(entry));
}

function isValidRequirementField(raw: unknown): raw is RequirementField {
  if (!raw || typeof raw !== "object") return false;
  const field = raw as Record<string, unknown>;
  if (field.type === "group") {
    return (
      typeof field.label === "string" &&
      Array.isArray(field.fields) &&
      (field.fields as unknown[]).every(
        (f) => f && typeof f === "object" && isValidLeafField(f as Record<string, unknown>),
      )
    );
  }
  return isValidLeafField(field);
}

export type ListTemplatesOptions = {
  includeDevelopment?: boolean;
};

export function isTemplateVisible(
  manifest: AgentManifest,
  options: ListTemplatesOptions = {},
): boolean {
  return manifest.visibility !== "development" || options.includeDevelopment === true;
}

/**
 * The system Source Agent's Template id (ADR-052): every Project activates it
 * once and Source scoring/routing dispatch onto it. The one Template id the
 * platform itself depends on, declared here (not in Convex, which a CI guard
 * keeps free of Template ids, #663) next to the rules reserving the
 * `@opengroow` scope.
 */
export const SOURCE_AGENT_TEMPLATE_ID = "@opengroow/source";
