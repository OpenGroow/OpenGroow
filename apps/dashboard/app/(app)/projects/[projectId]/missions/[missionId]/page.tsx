import { MissionDetailPage } from "@/src/components/mission-detail-page";

export default function Page({
  params,
}: {
  params: Promise<{ projectId: string; missionId: string }>;
}) {
  return <MissionDetailPage params={params} />;
}
