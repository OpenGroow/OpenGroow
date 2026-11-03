import { ChannelsPageContent } from "@/src/components/channels-page-content";

type Props = { params: Promise<{ projectId: string }> };

export default async function ChannelsPage({ params }: Props) {
  const { projectId } = await params;
  return <ChannelsPageContent resolvedInstanceId={decodeURIComponent(projectId)} />;
}
