import type { TemplateRegistry } from "@opengroow/agent-templates/registry";
import type { RunResult } from "../run_result.js";
import { validateDeclaredBlockerCode } from "./reconciliation.js";

export async function resolveMissionTypeBlockerCodes(
  registry: TemplateRegistry,
  projectId: string,
  templateId: string,
  missionType: string,
  version?: string,
): Promise<readonly string[] | undefined> {
  const missionTypeEntry = (await registry.resolve(projectId, templateId, version))?.manifest.missionTypes?.find(
    (entry) => entry.type === missionType,
  );
  return missionTypeEntry
    ? missionTypeEntry.blockers?.map((blocker) => blocker.code) ?? []
    : undefined;
}

/** The Mission type's `publish` declaration (ADR-069), or undefined when it has none. */
export async function resolveMissionTypePublish(
  registry: TemplateRegistry,
  projectId: string,
  templateId: string,
  missionType: string,
  version?: string,
): Promise<{ kind: string; targets: string[] } | undefined> {
  const entry = (await registry.resolve(projectId, templateId, version))?.manifest.missionTypes?.find(
    (candidate) => candidate.type === missionType,
  );
  return entry?.publish;
}

export async function validateTerminalRunResult(
  registry: TemplateRegistry,
  projectId: string,
  result: RunResult,
  templateId: string,
  missionType: string,
  version?: string,
): Promise<string | undefined> {
  return validateDeclaredBlockerCode(result, {
    missionType,
    blockerCodes: await resolveMissionTypeBlockerCodes(registry, projectId, templateId, missionType, version),
  });
}
