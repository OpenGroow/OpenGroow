import { MissionRunPromptView } from "@/src/components/mission-run-page";

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string; missionId: string; runId: string }>;
}) {
  const { projectId, runId, missionId } = await params;
  return (
    <MissionRunPromptView
      instanceId={decodeURIComponent(projectId)}
      missionId={decodeURIComponent(missionId)}
      runId={decodeURIComponent(runId)}
    />
  );
}
