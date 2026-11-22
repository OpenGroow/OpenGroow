import { ProductionRecipePage } from "@/src/components/production-recipe-page";

export default function Page({
  params,
}: {
  params: Promise<{ projectId: string; familyId: string; recipeId: string }>;
}) {
  return <ProductionRecipePage params={params} />;
}
