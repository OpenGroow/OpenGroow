import { flattenRequirementFields } from "./requirements";
import type { AgentManifest, MachinePrerequisite } from "./types";

/**
 * What adding an Agent of a Template does to the Project, shown before the
 * user confirms (#655): the hosts its MCP servers are called on, the secrets
 * it asks for, and the skills installed with it. Pure and derived from the
 * manifest only, so the dashboard and Convex agree on it.
 */
export type InstallationPlan = {
  mcpHosts: string[];
  secrets: { key: string; label: string; required: boolean }[];
  skills: string[];
  /**
   * Software to install on the user's own machine; never enforced (#662).
   * `installFrom` (the download host) is set when the installer can install it
   * after explicit consent on the paired machine (#726).
   */
  prerequisites: (Omit<MachinePrerequisite, "install"> & { installFrom?: string })[];
};

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function buildInstallationPlan(manifest: AgentManifest): InstallationPlan {
  const hosts = manifest.mcpServers.flatMap((server) =>
    [server.url, server.activationUrl].filter((url): url is string => typeof url === "string").map(hostOf),
  );
  return {
    mcpHosts: [...new Set(hosts)],
    secrets: flattenRequirementFields(manifest.requirements)
      .filter((field) => field.type === "password")
      .map((field) => ({ key: field.key, label: field.label, required: field.required === true })),
    skills: [...new Set((manifest.skills ?? []).map((skill) => skill.spec))],
    prerequisites: (manifest.machinePrerequisites ?? []).map(({ name, minVersion, instructionsUrl, installCommand, externalPrerequisites, install }) => ({
      name,
      ...(minVersion !== undefined ? { minVersion } : {}),
      instructionsUrl,
      ...(installCommand !== undefined ? { installCommand } : {}),
      ...(externalPrerequisites?.length ? { externalPrerequisites } : {}),
      ...(install ? { installFrom: hostOf(install.source.url) } : {}),
    })),
  };
}
