"use client";

import type { InstanceRecord } from "@/src/components/instance-workspace.types";
import { findInstanceById } from "@/src/components/instance-workspace.utils";
import { InstanceDangerZone } from "@/src/components/instance-danger-zone";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Props = { resolvedInstanceId: string };

export function SecurityPageContent({ resolvedInstanceId }: Props) {
  const instances = useAuthenticatedInstances<InstanceRecord>();

  const instance = findInstanceById(instances, resolvedInstanceId);

  if (!instance) {
    return null;
  }

  return (
    <section className="grid gap-5">
      <Card className="gap-5 rounded-[1.5rem] border-0 bg-white/92 py-6 shadow-[0_18px_48px_rgba(25,28,28,0.08)] ring-1 ring-[rgba(0,38,27,0.08)]">
        <CardHeader className="grid gap-2 px-6 pb-0">
          <CardTitle className="text-[1.35rem] leading-[1.1] tracking-[-0.04em] text-[var(--dashboard-ink)]">
            Gateway Token
          </CardTitle>
          <CardDescription className="max-w-2xl text-base leading-7 text-[var(--dashboard-ink-muted)]">
            Use this token for external integrations and connect tickets.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 px-6">
          <code className="block w-full rounded-xl border border-[rgba(0,38,27,0.08)] bg-[rgba(243,244,244,0.95)] px-4 py-3 text-sm text-[var(--dashboard-ink)] [filter:blur(6px)] transition duration-150 hover:[filter:blur(0)] focus-visible:[filter:blur(0)] [overflow-wrap:anywhere]">
            {instance.openclawGatewayToken ?? "The gateway token is not available yet."}
          </code>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={!instance.openclawGatewayToken}
              onClick={() =>
                instance.openclawGatewayToken
                  ? void navigator.clipboard.writeText(instance.openclawGatewayToken)
                  : undefined
              }
              className="h-11 rounded-xl bg-[rgba(220,230,224,0.66)] px-5 text-[var(--dashboard-primary)] hover:bg-[rgba(220,230,224,0.82)]"
            >
              Copy token
            </Button>
          </div>
        </CardContent>
      </Card>

      <InstanceDangerZone jobId={instance.jobId} />
    </section>
  );
}
