import { EditorialCalendarPage } from "@/src/components/editorial-calendar-page";

export default function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const mappedParams = params.then(({ projectId }) => ({ instanceId: projectId }));
  return <EditorialCalendarPage params={mappedParams} />;
}
