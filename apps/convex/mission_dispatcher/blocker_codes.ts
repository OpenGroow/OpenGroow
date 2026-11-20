import { publishDeclarationFor, type PublishDeclaration } from "@opengroow/agent-templates";
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

/** The Mission type is reviewed as a Plan (`review.kind` "plan", ADR-081). */
export async function resolveMissionTypeIsPlan(
  registry: TemplateRegistry,
  projectId: string,
  templateId: string,
  missionType: string,
  version?: string,
): Promise<boolean> {
  const manifest = (await registry.resolve(projectId, templateId, version))?.manifest;
  return manifest?.missionTypes?.find((entry) => entry.type === missionType)?.review?.kind === "plan";
}

/** The Mission type's `publish` declaration (ADR-069), or undefined when it has none. */
export async function resolveMissionTypePublish(
  registry: TemplateRegistry,
  projectId: string,
  templateId: string,
  missionType: string,
  version?: string,
): Promise<PublishDeclaration | undefined> {
  return publishDeclarationFor((await registry.resolve(projectId, templateId, version))?.manifest, missionType);
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
