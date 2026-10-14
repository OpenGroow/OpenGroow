"use client";

import { use } from "react";
import { UsagePanel } from "@/src/components/usage-panel";

type UsagePageProps = {
  params: Promise<{ projectId: string }>;
};

export default function ProjectUsagePage({ params }: UsagePageProps) {
  const { projectId } = use(params);
  const resolvedInstanceId = decodeURIComponent(projectId);

  return (
    <section className="grid gap-5">
      <UsagePanel instanceId={resolvedInstanceId} />
    </section>
  );
}
