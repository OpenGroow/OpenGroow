import { InstanceSchedulesPage } from "@/src/components/instance-schedules-page";

export default function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const mappedParams = params.then(({ projectId }) => ({ instanceId: projectId }));
  return <InstanceSchedulesPage params={mappedParams} />;
}
