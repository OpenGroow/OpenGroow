"use client";

import Link from "next/link";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InstanceRecord } from "@/src/components/instance-workspace.types";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";

/**
 * The first-run warning: no AI Provider is set up for the Project, so no Agent
 * can run a Mission yet. Points to Settings → Providers. Renders nothing while
 * the Project loads or once a Provider exists, so it never flashes.
 */
export function NoProviderNotice({ projectId }: { projectId: string }) {
  const instances = useAuthenticatedInstances<InstanceRecord>();
  const project = instances?.find((entry) => entry.openclawId === projectId || entry.jobId === projectId);
  if (project === undefined || (project.providers ?? []).length > 0) return null;

  return (
    <section
      data-testid="no-provider-notice"
      className="flex max-w-full flex-wrap items-center gap-4 rounded-xl border border-status-warning/30 bg-status-warning/10 p-5 lg:w-fit lg:gap-6"
    >
      <TriangleAlert aria-hidden="true" className="size-5 shrink-0 text-status-warning" />
      <div className="grid min-w-0 flex-1 gap-1">
        <h2 className="m-0 text-base font-semibold text-status-warning">Add an AI provider to get started</h2>
        <p className="m-0 text-sm text-status-warning">
          Your agents need an AI provider to run Missions. Connect a subscription or an API key in Settings.
        </p>
      </div>
      <Button
        variant="outline"
        nativeButton={false}
        render={<Link href={`/projects/${encodeURIComponent(projectId)}/settings/providers`} />}
      >
        Add a provider
        <ArrowRight />
      </Button>
    </section>
  );
}
