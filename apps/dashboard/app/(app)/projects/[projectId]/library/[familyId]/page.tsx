import { CreativeFamilyPage } from "@/src/components/creative-family-page";

export default function Page({
  params,
}: {
  params: Promise<{ projectId: string; familyId: string }>;
}) {
  return <CreativeFamilyPage params={params} />;
}
