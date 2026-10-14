import { SourceDetailPage } from "@/src/components/source-detail-page";

export default function Page({
  params,
}: {
  params: Promise<{ projectId: string; sourceId: string }>;
}) {
  return <SourceDetailPage params={params} />;
}
