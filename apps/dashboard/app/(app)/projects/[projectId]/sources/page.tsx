import { InstanceSourcesPage } from "@/src/components/instance-sources-page";

export default function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const mappedParams = params.then(({ projectId }) => ({ instanceId: projectId }));
  return <InstanceSourcesPage params={mappedParams} />;
}
