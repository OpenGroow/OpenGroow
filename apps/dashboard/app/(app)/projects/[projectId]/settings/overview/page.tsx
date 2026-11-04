import { OverviewPageContent } from "@/src/components/overview-page-content";

type Props = { params: Promise<{ projectId: string }> };

export default async function OverviewPage({ params }: Props) {
  const { projectId } = await params;
  return <OverviewPageContent resolvedInstanceId={projectId} />;
}
