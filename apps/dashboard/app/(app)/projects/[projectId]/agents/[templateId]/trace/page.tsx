import { AgentRunTraceView } from "@/src/components/trace/agent-run-trace-view";
import { templateIdFromSegment } from "@/src/lib/template-route";

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string; templateId: string }>;
}) {
  const { projectId, templateId } = await params;
  return <AgentRunTraceView instanceId={decodeURIComponent(projectId)} templateId={templateIdFromSegment(templateId)} />;
}
