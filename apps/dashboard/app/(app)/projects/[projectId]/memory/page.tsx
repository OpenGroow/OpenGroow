import { StrategicMemoryPage } from "@/src/components/strategic-memory-page";

export default function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const mappedParams = params.then(({ projectId }) => ({ instanceId: projectId }));
  return <StrategicMemoryPage params={mappedParams} />;
}
