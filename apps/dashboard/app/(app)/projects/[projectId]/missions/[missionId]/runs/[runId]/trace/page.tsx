import { MissionRunTraceView } from "@/src/components/mission-run-page";

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string; missionId: string; runId: string }>;
}) {
  const { projectId, runId } = await params;
  return <MissionRunTraceView instanceId={decodeURIComponent(projectId)} runId={decodeURIComponent(runId)} />;
}
