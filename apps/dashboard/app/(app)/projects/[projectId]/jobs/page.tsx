import { InstanceJobsPage } from "@/src/components/instance-jobs-page";

export default function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const mappedParams = params.then(({ projectId }) => ({ instanceId: projectId }));
  return <InstanceJobsPage params={mappedParams} />;
}
