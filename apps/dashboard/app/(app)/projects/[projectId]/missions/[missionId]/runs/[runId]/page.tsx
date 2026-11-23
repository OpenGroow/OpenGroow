import { redirect } from "next/navigation";

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string; missionId: string; runId: string }>;
}) {
  const { projectId, missionId, runId } = await params;
  redirect(`/projects/${projectId}/missions/${missionId}/runs/${runId}/prompt`);
}
