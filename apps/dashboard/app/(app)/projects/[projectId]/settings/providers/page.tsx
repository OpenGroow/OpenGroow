import { ProvidersPageContent } from "@/src/components/providers-page-content";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectProvidersPage({ params }: Props) {
  const { projectId } = await params;
  return <ProvidersPageContent resolvedInstanceId={decodeURIComponent(projectId)} />;
}
