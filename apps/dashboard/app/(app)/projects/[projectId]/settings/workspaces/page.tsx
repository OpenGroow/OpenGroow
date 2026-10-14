import { InstanceWorkspacesPage } from "@/src/components/instance-workspaces-page";

export default function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const mappedParams = params.then(({ projectId }) => ({ instanceId: projectId }));
  return <InstanceWorkspacesPage params={mappedParams} />;
}
