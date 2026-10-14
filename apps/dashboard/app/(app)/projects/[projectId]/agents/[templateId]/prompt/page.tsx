import { AgentPromptView } from "@/src/components/agent-workspace-view";
import { templateIdFromSegment } from "@/src/lib/template-route";

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string; templateId: string }>;
}) {
  const { projectId, templateId } = await params;
  return <AgentPromptView instanceId={decodeURIComponent(projectId)} templateId={templateIdFromSegment(templateId)} />;
}
