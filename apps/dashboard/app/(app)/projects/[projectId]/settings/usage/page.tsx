import { UsagePanel } from "@/src/components/usage-panel";

type UsagePageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectUsagePage({ params }: UsagePageProps) {
  const { projectId } = await params;

  return (
    <section className="grid gap-5">
      <UsagePanel instanceId={projectId} />
    </section>
  );
}
