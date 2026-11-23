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
 * One Run of a Mission, under the Mission: its Prompt and its Logs ("View
 * prompt" / "View logs" on a Mission's Runs). A Source's or a job's Run has no
 * Mission and keeps `runLogsHref` (the Agent's Logs).
 */
export function missionRunHref(instanceId: string, missionId: string, runId: string, tab: "prompt" | "logs"): string {
  return `/projects/${encodeURIComponent(instanceId)}/missions/${encodeURIComponent(missionId)}/runs/${encodeURIComponent(runId)}/${tab}`;
}
