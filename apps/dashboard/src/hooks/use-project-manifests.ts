"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { AgentManifest } from "@convex/template_manifest_contract";

const NO_MANIFESTS: AgentManifest[] = [];

/**
 * The manifests of the Templates a Project offers, read from Convex.
 * `manifests` is empty while loading or when the Project is not readable;
 * `loading` lets forms that validate against the manifests (Mission types,
 * payload fields) wait for them instead of falling back to free text.
 */
export function useProjectManifests(projectId: string): { manifests: AgentManifest[]; loading: boolean } {
  const manifests = useQuery(api.project_templates.listForProject, { projectId });
  return { manifests: manifests ?? NO_MANIFESTS, loading: manifests === undefined };
}

/**
 * One Template's manifest in a Project: `undefined` while loading, `null` when
 * the Project does not offer it (callers 404).
 */
export function useProjectManifest(projectId: string, templateId: string): AgentManifest | null | undefined {
  return useQuery(api.project_templates.getForProject, { projectId, templateId });
}
