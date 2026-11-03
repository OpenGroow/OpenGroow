import { SecurityPageContent } from "@/src/components/security-page-content";

type Props = { params: Promise<{ projectId: string }> };

export default async function SecurityPage({ params }: Props) {
  const { projectId } = await params;
  return <SecurityPageContent resolvedInstanceId={decodeURIComponent(projectId)} />;
}
