"use client";

import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { InstanceRecord } from "@/src/components/instance-workspace.types";

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
      <div className="grid gap-3 rounded-[1.75rem] border border-[rgba(0,38,27,0.08)] bg-[#f8f9f7] p-5 shadow-[0_18px_34px_rgba(25,28,28,0.06)]">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex rounded-full bg-white px-3 py-1 text-[0.78rem] font-bold uppercase tracking-[0.14em] text-[var(--dashboard-ink-soft)]">
            {instance.runtimeStatus ?? instance.status}
          </span>
          {instance.ipv4 ? (
            <span className="inline-flex rounded-full bg-white px-3 py-1 text-[0.78rem] font-bold uppercase tracking-[0.14em] text-[var(--dashboard-ink-soft)]">
              {instance.ipv4}
            </span>
          ) : null}
          {lastUpdatedAt ? (
            <span className="text-[0.82rem] text-[var(--dashboard-ink-soft)]">
              Logs refreshed {formatRelativeTime(lastUpdatedAt)}
            </span>
          ) : null}
        </div>
        {logsError ? (
          <p className="m-0 text-[0.92rem] leading-7 text-[var(--dashboard-tertiary)]">
            {logsError}
          </p>
        ) : null}
        <pre className="m-0 max-h-48 overflow-auto rounded-2xl border border-[rgba(0,38,27,0.08)] bg-white p-4 text-xs leading-6 text-[var(--dashboard-ink-muted)]">
          {statusOutput}
        </pre>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <LogCard title="Gateway Logs" output={gatewayLogs} />
        <LogCard title="Runtime Worker Logs" output={workerLogs} />
      </div>
    </div>
  );
}

function LogCard({ title, output }: { title: string; output: string }) {
  return (
    <article className="grid gap-3 rounded-[1.75rem] border border-[rgba(0,38,27,0.08)] bg-[#f8f9f7] p-5 shadow-[0_18px_34px_rgba(25,28,28,0.06)]">
      <h2 className="m-0 text-[0.95rem] font-bold uppercase tracking-[0.14em] text-[var(--dashboard-ink-soft)]">
        {title}
      </h2>
      <pre className="m-0 max-h-[22rem] overflow-auto rounded-2xl border border-[rgba(0,38,27,0.08)] bg-white p-4 text-xs leading-6 text-[var(--dashboard-ink-muted)]">
        {output}
      </pre>
    </article>
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
