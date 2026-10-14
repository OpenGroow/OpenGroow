import { AgentSettings } from "@/src/components/agent-page";
import { isSelfHost } from "@/src/lib/self-host";
import { templateIdFromSegment } from "@/src/lib/template-route";

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string; templateId: string }>;
}) {
  const { projectId, templateId } = await params;
  return (
    <AgentSettings
      instanceId={decodeURIComponent(projectId)}
      templateId={templateIdFromSegment(templateId)}
      selfHost={isSelfHost()}
    />
  );
}
