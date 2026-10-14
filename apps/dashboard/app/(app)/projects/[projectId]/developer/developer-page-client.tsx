"use client";

import { LogsPanel } from "@/src/components/logs-panel";
import { BurstInstancePanel } from "@/src/components/burst-instance-panel";
import { useResolvedProjectId } from "@/src/hooks/use-resolved-project-id";

type DeveloperPageProps = {
  params: Promise<{ projectId: string }>;
};

export default function DeveloperPageClient({ params }: DeveloperPageProps) {
  const resolvedInstanceId = useResolvedProjectId(params);

  if (!resolvedInstanceId) {
    return null;
  }

  return (
    <section className="grid gap-5">
      <LogsPanel instanceId={resolvedInstanceId} />
      <details className="mt-8 rounded-3xl bg-white/45 shadow-[inset_0_0_0_1px_rgba(192,200,195,0.18)]">
        <summary className="list-none cursor-pointer px-5 py-4 font-bold text-[var(--dashboard-primary)] [&::-webkit-details-marker]:hidden">
          Developer controls
        </summary>
        <div className="px-4 pb-4">
          <BurstInstancePanel instanceId={resolvedInstanceId} />
        </div>
      </details>
    </section>
  );
}
