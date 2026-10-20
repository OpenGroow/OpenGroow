import { ProjectOverviewPage } from "@/src/components/project-overview-page";

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectOverviewPage projectId={decodeURIComponent(projectId)} />;
}
