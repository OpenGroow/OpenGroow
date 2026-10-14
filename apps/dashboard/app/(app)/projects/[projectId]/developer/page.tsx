import { redirectIfSelfHost } from "@/src/lib/self-host";
import DeveloperPageClient from "./developer-page-client";

type DeveloperPageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function DeveloperPage({ params }: DeveloperPageProps) {
  const { projectId } = await params;
  redirectIfSelfHost(projectId);

  return <DeveloperPageClient params={params} />;
}
