import { CreativeLibraryPage } from "@/src/components/creative-library-page";

export default function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const mappedParams = params.then(({ projectId }) => ({ instanceId: projectId }));
  return <CreativeLibraryPage params={mappedParams} />;
}
