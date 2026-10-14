import { MissionReviewPage } from "@/src/components/mission-review-page";

export default function Page({
  params,
}: {
  params: Promise<{ projectId: string; missionId: string }>;
}) {
  const mappedParams = params.then(({ projectId, missionId }) => ({
    instanceId: projectId,
    missionId,
  }));
  return <MissionReviewPage params={mappedParams} />;
}
