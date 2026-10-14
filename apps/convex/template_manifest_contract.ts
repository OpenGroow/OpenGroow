/**
 * Browser-safe view of the Template manifest contract, for the dashboard.
 *
 * The dashboard does not depend on the Template package: it reads manifests
 * through the Project-scoped queries of `project_templates.ts` and takes the
 * manifest types and the pure helpers that walk a manifest from here. Only
 * types and side-effect-free functions (no `node:fs`) belong in this module.
 */
export type {
  AgentManifest,
  LeafRequirementField,
  MissionPayloadField,
  MissionType,
  RequirementField,
} from "@opengroow/agent-templates/types";
export type { ProjectAgentSkill } from "@opengroow/agent-templates/skills";
export type { InstallationPlan } from "@opengroow/agent-templates/installation-plan";
export { buildInstallationPlan } from "@opengroow/agent-templates/installation-plan";
export type { UpdatePlan } from "@opengroow/agent-templates/update-plan";
export {
  flattenRequirementFields,
  hasRetryableStatusCheck,
  resolveLabelTokens,
} from "@opengroow/agent-templates/requirements";
export { templateSupportsAutoPublish } from "@opengroow/agent-templates/review-contract";
export { filesFromFolder, type FolderEntry } from "@opengroow/agent-templates/folder-files";
