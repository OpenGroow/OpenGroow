"use client";

import type { InstanceRecord } from "@/src/components/instance-workspace.types";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";

/**
 * Resolves a dashboard URL's `projectId` param to the runtime's own
 * `openclawId` — the two aren't always the same value (a Project can be
 * looked up by either its `openclawId` or its `jobId`). Shared by every page
 * that calls a workspace/runtime action keyed by instance id (e.g.
 * `getWorkspaceRunTranscript`).
 */
export function useRuntimeInstanceId(projectId: string): string {
  const instances = useAuthenticatedInstances<InstanceRecord>();
  const instance = instances?.find((entry) => entry.openclawId === projectId || entry.jobId === projectId);
  return instance?.openclawId?.trim() ?? "";
}
