"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api.js";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";

type InstanceRow = {
  _id: string;
  jobId: string;
  displayName?: string;
  openclawName?: string;
  openclawId?: string;
  openclawServerId?: number;
  brokerServerId?: number;
  ipv4?: string;
  updatedAt?: string;
};

type OutputState = {
  title: string;
  output: string;
};

type LogsPanelProps = {
  instanceId?: string;
};

const sectionClass = "mt-4 grid gap-3";
const panelClass = "rounded-2xl border border-stone-200 bg-white/80 p-4 shadow-sm";
const chipClass =
  "inline-flex items-center rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-sm text-stone-700 shadow-sm";
const inputClass =
  "rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-200";
const primaryButtonClass =
  "rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButtonClass =
  "rounded-xl bg-teal-800 px-3 py-2 text-sm font-semibold text-white transition hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-50";
const preClass =
  "overflow-x-auto whitespace-pre-wrap rounded-2xl border border-stone-200 bg-stone-50 p-4 text-xs leading-6 text-stone-700";

export function LogsPanel({ instanceId }: LogsPanelProps) {
  const instances = useAuthenticatedInstances<InstanceRow>();

  const getOpenClawStatus = useAction(api.instances_node.getOpenClawStatus);
  const getOpenClawLogs = useAction(api.instances_node.getOpenClawLogs);
  const getBrokerStatus = useAction(api.instances_node.getBrokerStatus);
  const getBrokerLogs = useAction(api.instances_node.getBrokerLogs);

  const [tail, setTail] = useState("200");
  const [loading, setLoading] = useState<Record<string, string | undefined>>({});
  const [outputs, setOutputs] = useState<Record<string, OutputState>>({});
  const visibleInstances = instanceId
    ? instances?.filter(
        (instance) =>
          instance.openclawId === instanceId || instance.jobId === instanceId,
      )
    : instances;

  function parseTail(): number | undefined {
    const value = Number(tail);
    if (!Number.isFinite(value) || value <= 0) {
      return undefined;
    }
    return Math.trunc(value);
  }

  async function runForInstance(
    instance: InstanceRow,
    op: "openclaw-status" | "openclaw-gateway-logs" | "openclaw-worker-logs" | "broker-status" | "broker-logs"
  ): Promise<void> {
    const key = instance._id;
    const openclawServerId = instance.openclawServerId;
    const brokerServerId = instance.brokerServerId;
    const openclawIpv4 = instance.ipv4;

    setLoading((prev) => ({ ...prev, [key]: op }));

    try {
      if (op === "openclaw-status") {
        const result = (await getOpenClawStatus({
          serverId: openclawServerId,
          ipv4: openclawIpv4
        })) as { output?: string; error?: string };
        setOutputs((prev) => ({
          ...prev,
          [key]: {
            title: "OpenClaw status",
            output: result.error ?? result.output ?? "No output"
          }
        }));
        return;
      }

      if (op === "openclaw-gateway-logs") {
        const result = (await getOpenClawLogs({
          serverId: openclawServerId,
          ipv4: openclawIpv4,
          service: "openclaw-gateway",
          tail: parseTail()
        })) as { output?: string; error?: string };
        setOutputs((prev) => ({
          ...prev,
          [key]: {
            title: "OpenClaw gateway logs",
            output: result.error ?? result.output ?? "No output"
          }
        }));
        return;
      }

      if (op === "openclaw-worker-logs") {
        const result = (await getOpenClawLogs({
          serverId: openclawServerId,
          ipv4: openclawIpv4,
          service: "openclaw-runtime-worker",
          tail: parseTail()
        })) as { output?: string; error?: string };
        setOutputs((prev) => ({
          ...prev,
          [key]: {
            title: "OpenClaw runtime worker logs",
            output: result.error ?? result.output ?? "No output"
          }
        }));
        return;
      }

      if (op === "broker-status") {
        if (!brokerServerId) {
          throw new Error("Broker server id missing for this Project");
        }
        const result = (await getBrokerStatus({
          serverId: brokerServerId
        })) as { output?: string; error?: string };
        setOutputs((prev) => ({
          ...prev,
          [key]: {
            title: "Broker status",
            output: result.error ?? result.output ?? "No output"
          }
        }));
        return;
      }

      if (!brokerServerId) {
        throw new Error("Broker server id missing for this Project");
      }
      const result = (await getBrokerLogs({
        serverId: brokerServerId,
        tail: parseTail()
      })) as { output?: string; error?: string };
      setOutputs((prev) => ({
        ...prev,
        [key]: {
          title: "Broker logs",
          output: result.error ?? result.output ?? "No output"
        }
      }));
    } catch (error: unknown) {
      setOutputs((prev) => ({
        ...prev,
        [key]: {
          title: "Error",
          output: error instanceof Error ? error.message : "Unknown error"
        }
      }));
    } finally {
      setLoading((prev) => ({ ...prev, [key]: undefined }));
    }
  }

  return (
    <section className={sectionClass}>
      <article className={panelClass}>
        <h3 className="mb-3 text-base font-semibold text-stone-900">Logs Controls</h3>
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="text-sm text-stone-500" htmlFor="tail-input">
            Tail lines
          </label>
          <input
            id="tail-input"
            value={tail}
            onChange={(event) => setTail(event.target.value)}
            className={`${inputClass} w-24`}
          />
        </div>
      </article>

      {!instances?.length ? (
        <article className={panelClass}>
          <h3 className="mb-2 text-base font-semibold text-stone-900">No Projects</h3>
          <p className="text-sm text-stone-500">Create a Project first in the main dashboard page.</p>
        </article>
      ) : null}

      {instances?.length && instanceId && !visibleInstances?.length ? (
        <article className={panelClass}>
          <h3 className="mb-2 text-base font-semibold text-stone-900">Project Not Found</h3>
          <p className="text-sm text-stone-500">
            No project matched <code>{instanceId}</code>.
          </p>
        </article>
      ) : null}

      {visibleInstances?.map((instance) => {
        const key = instance._id;
        const current = outputs[key];
        const pending = loading[key];
        const hasBrokerServer = typeof instance.brokerServerId === "number";
        return (
          <article className={panelClass} key={key}>
            <h3 className="text-base font-semibold text-stone-900">
              {instance.displayName?.trim() || "Untitled Project"}
            </h3>
            <div className="mt-3 flex flex-wrap gap-2.5">
              <span className={chipClass}>openclaw server: {instance.openclawServerId ?? "n/a"}</span>
              {hasBrokerServer ? (
                <span className={chipClass}>broker server: {instance.brokerServerId}</span>
              ) : null}
              <span className={chipClass}>ipv4: {instance.ipv4 ?? "n/a"}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => runForInstance(instance, "openclaw-status")} className={primaryButtonClass}>
                OpenClaw Status
              </button>
              <button onClick={() => runForInstance(instance, "openclaw-gateway-logs")} className={primaryButtonClass}>
                Gateway Logs
              </button>
              <button onClick={() => runForInstance(instance, "openclaw-worker-logs")} className={primaryButtonClass}>
                Worker Logs
              </button>
              {hasBrokerServer ? (
                <button onClick={() => runForInstance(instance, "broker-status")} className={secondaryButtonClass}>
                  Broker Status
                </button>
              ) : null}
              {hasBrokerServer ? (
                <button onClick={() => runForInstance(instance, "broker-logs")} className={secondaryButtonClass}>
                  Broker Logs
                </button>
              ) : null}
            </div>
            {pending ? <p className="mt-3 text-sm text-stone-500">Running: {pending}</p> : null}
            {current ? (
              <>
                <p className="mb-1.5 mt-3 text-sm text-stone-500">
                  {current.title}
                </p>
                <pre className={`${preClass} max-h-[420px] overflow-auto`}>
                  {current.output}
                </pre>
              </>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
