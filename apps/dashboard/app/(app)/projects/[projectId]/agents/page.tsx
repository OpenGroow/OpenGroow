import { isSelfHost } from "@/src/lib/self-host";
import { InstanceAgentsPage } from "@/src/components/instance-agents-page";

export default function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const mappedParams = params.then(({ projectId }) => ({ instanceId: projectId }));
  return <InstanceAgentsPage params={mappedParams} selfHost={isSelfHost()} />;
}
