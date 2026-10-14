import { AgentOverview } from "@/src/components/agent-page";
import { templateIdFromSegment } from "@/src/lib/template-route";

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string; templateId: string }>;
}) {
  const { projectId, templateId } = await params;
  return <AgentOverview instanceId={decodeURIComponent(projectId)} templateId={templateIdFromSegment(templateId)} />;
}
