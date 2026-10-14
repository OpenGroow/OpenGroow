import { AgentPageLayout } from "@/src/components/agent-page";
import { templateIdFromSegment } from "@/src/lib/template-route";

export default async function Layout({
  params,
  children,
}: {
  params: Promise<{ projectId: string; templateId: string }>;
  children: React.ReactNode;
}) {
  const { projectId, templateId } = await params;

  return (
    <AgentPageLayout instanceId={decodeURIComponent(projectId)} templateId={templateIdFromSegment(templateId)}>
      {children}
    </AgentPageLayout>
  );
}
