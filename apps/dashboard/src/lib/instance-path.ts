type InstancePathSource = {
  jobId: string;
  openclawId?: string;
};

export function getInstancePathId(instance: InstancePathSource): string {
  return instance.openclawId?.trim() || instance.jobId;
}

/**
 * The Agent Logs deep link that opens one Run's transcript: the "View logs"
 * target shared by a Mission's Runs, a Source's Run and a job's latest Run
 * (#565). `workspace-logs-page.tsx` reads the `runId` query param on mount.
 */
export function runLogsHref(instanceId: string, templateId: string, runId: string): string {
  const project = encodeURIComponent(instanceId);
  const template = encodeURIComponent(templateId);
  return `/projects/${project}/agents/${template}/logs?runId=${encodeURIComponent(runId)}`;
}

/**
 * The Agent prompt page for one Run of a Mission ("View prompt" on a Mission's
 * Runs). `workspace-prompt-page.tsx` reads `runId` and `missionId` on mount.
 */
export function runPromptHref(instanceId: string, templateId: string, runId: string, missionId: string): string {
  const project = encodeURIComponent(instanceId);
  const template = encodeURIComponent(templateId);
  return `/projects/${project}/agents/${template}/prompt?runId=${encodeURIComponent(runId)}&missionId=${encodeURIComponent(missionId)}`;
}
