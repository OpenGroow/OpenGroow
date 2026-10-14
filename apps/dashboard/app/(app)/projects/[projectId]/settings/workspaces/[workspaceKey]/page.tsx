import { InstanceWorkspaceDetailPage } from "@/src/components/instance-workspace-detail-page";

export default function Page({
  params,
}: {
  params: Promise<{ projectId: string; workspaceKey: string }>;
}) {
  const mappedParams = params.then(({ projectId, workspaceKey }) => ({
    instanceId: projectId,
    workspaceKey,
  }));
  return <InstanceWorkspaceDetailPage params={mappedParams} />;
}
