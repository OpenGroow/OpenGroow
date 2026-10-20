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
      <Card className="gap-5 py-6">
        <CardHeader className="grid gap-2 px-6 pb-0">
          <CardTitle className="text-lg tracking-tight text-foreground">
            Gateway Token
          </CardTitle>
          <CardDescription className="max-w-2xl text-base leading-7 text-muted-foreground">
            Use this token for external integrations and connect tickets.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 px-6">
          <code className="block w-full rounded-xl border border-border bg-muted px-4 py-3 text-sm text-foreground [filter:blur(6px)] transition duration-150 hover:[filter:blur(0)] focus-visible:[filter:blur(0)] [overflow-wrap:anywhere]">
            {instance.openclawGatewayToken ?? "The gateway token is not available yet."}
          </code>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" size="lg"
              type="button"
              disabled={!instance.openclawGatewayToken}
              onClick={() =>
                instance.openclawGatewayToken
                  ? void navigator.clipboard.writeText(instance.openclawGatewayToken)
                  : undefined
              }
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
