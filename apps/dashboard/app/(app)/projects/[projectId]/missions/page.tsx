import { InstanceMissionsPage } from "@/src/components/instance-missions-page";

export default function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const mappedParams = params.then(({ projectId }) => ({ instanceId: projectId }));
  return <InstanceMissionsPage params={mappedParams} />;
}
