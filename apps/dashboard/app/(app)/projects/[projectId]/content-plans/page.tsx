import { ContentPlansPage } from "@/src/components/content-plans-page";

export default function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const mappedParams = params.then(({ projectId }) => ({ instanceId: projectId }));
  return <ContentPlansPage params={mappedParams} />;
}
