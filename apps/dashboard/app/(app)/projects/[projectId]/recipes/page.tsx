import { RecipesPage } from "@/src/components/recipes-page";

export default function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const mappedParams = params.then(({ projectId }) => ({ instanceId: projectId }));
  return <RecipesPage params={mappedParams} />;
}
