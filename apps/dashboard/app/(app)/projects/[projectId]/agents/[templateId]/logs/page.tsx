import { AgentLogsView } from "@/src/components/agent-workspace-view";
import { templateIdFromSegment } from "@/src/lib/template-route";

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string; templateId: string }>;
}) {
  const { projectId, templateId } = await params;
  return <AgentLogsView instanceId={decodeURIComponent(projectId)} templateId={templateIdFromSegment(templateId)} />;
}
