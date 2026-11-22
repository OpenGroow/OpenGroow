import { CreativeUnclassifiedPage } from "@/src/components/creative-unclassified-page";

export default function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const mappedParams = params.then(({ projectId }) => ({ instanceId: projectId }));
  return <CreativeUnclassifiedPage params={mappedParams} />;
}
