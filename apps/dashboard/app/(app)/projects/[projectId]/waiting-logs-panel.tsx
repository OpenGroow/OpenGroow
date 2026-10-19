"use client";

import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { InstanceRecord } from "@/src/components/instance-workspace.types";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export function WaitingLogsPanel({ instance }: { instance: InstanceRecord }) {
  const getOpenClawStatus = useAction(api.instances_node.getOpenClawStatus);
  const getOpenClawLogs = useAction(api.instances_node.getOpenClawLogs);
  const [statusOutput, setStatusOutput] = useState<string>("Waiting for node details…");
  const [gatewayLogs, setGatewayLogs] = useState<string>("Logs will appear here once the VM is reachable.");
  const [workerLogs, setWorkerLogs] = useState<string>("Logs will appear here once the runtime worker starts.");
  const [logsError, setLogsError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      if (!instance.openclawServerId && !instance.ipv4) {
        setLogsError(null);
        setStatusOutput("Provisioning has started, but the VM endpoint is not available yet.");
        setGatewayLogs("Waiting for server IP or server id…");
        setWorkerLogs("Waiting for server IP or server id…");
        return;
      }

      try {
        const [statusResult, gatewayResult, workerResult] = await Promise.all([
          getOpenClawStatus({
            serverId: instance.openclawServerId,
            ipv4: instance.ipv4,
          }) as Promise<{ output?: string; error?: string }>,
          getOpenClawLogs({
            serverId: instance.openclawServerId,
            ipv4: instance.ipv4,
            service: "openclaw-gateway",
            tail: 80,
          }) as Promise<{ output?: string; error?: string }>,
          getOpenClawLogs({
            serverId: instance.openclawServerId,
            ipv4: instance.ipv4,
            service: "openclaw-runtime-worker",
            tail: 80,
          }) as Promise<{ output?: string; error?: string }>,
        ]);

        if (cancelled) {
          return;
        }

        setLogsError(null);
        setStatusOutput(statusResult.error ?? statusResult.output ?? "No status output");
        setGatewayLogs(gatewayResult.error ?? gatewayResult.output ?? "No gateway logs");
        setWorkerLogs(workerResult.error ?? workerResult.output ?? "No runtime worker logs");
        setLastUpdatedAt(new Date().toISOString());
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }
        setLogsError(error instanceof Error ? error.message : "Failed to load project logs");
      }
    }

    void load();
    const interval = window.setInterval(() => {
      void load();
    }, 6000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [getOpenClawLogs, getOpenClawStatus, instance.ipv4, instance.openclawServerId]);

  return (
    <div className="mx-auto mt-10 grid w-full max-w-[960px] gap-5 text-left">
      <Card className="grid gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <Badge variant="outline">
            {instance.runtimeStatus ?? instance.status}
          </Badge>
          {instance.ipv4 ? (
            <Badge variant="outline">
              {instance.ipv4}
            </Badge>
          ) : null}
          {lastUpdatedAt ? (
            <span className="text-sm text-muted-foreground">
              Logs refreshed {formatRelativeTime(lastUpdatedAt)}
            </span>
          ) : null}
        </div>
        {logsError ? (
          <p className="m-0 text-sm leading-7 text-destructive">
            {logsError}
          </p>
        ) : null}
        <pre className="m-0 max-h-48 overflow-auto rounded-xl border border-border bg-card p-4 text-xs leading-6 text-muted-foreground">
          {statusOutput}
        </pre>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <LogCard title="Gateway Logs" output={gatewayLogs} />
        <LogCard title="Runtime Worker Logs" output={workerLogs} />
      </div>
    </div>
  );
}

function LogCard({ title, output }: { title: string; output: string }) {
  return (
    <Card className="grid gap-3 p-5">
      <h2 className="m-0 text-lg font-semibold text-foreground">
        {title}
      </h2>
      <pre className="m-0 max-h-[22rem] overflow-auto rounded-xl border border-border bg-card p-4 text-xs leading-6 text-muted-foreground">
        {output}
      </pre>
    </Card>
  );
}

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "recently";
  }

  const diffMs = Date.now() - date.getTime();
  const diffSeconds = Math.max(0, Math.round(diffMs / 1000));

  if (diffSeconds < 10) {
    return "just now";
  }
  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }

  const diffMinutes = Math.round(diffSeconds / 60);
  return `${diffMinutes}m ago`;
}
