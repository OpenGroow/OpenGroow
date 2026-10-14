"use client";

import { useState } from "react";
import { useQuery, useAction } from "convex/react";
import type { Doc } from "@convex/_generated/dataModel";
import { api } from "@convex/_generated/api";
import type { InstanceRecord } from "@/src/components/instance-workspace.types";

type CheckStatus = "idle" | "checking" | "ok" | "failed";

export type DevicesListState = {
  nodes: Doc<"connectedDevices">[] | undefined;
  checkStatus: CheckStatus;
  checkError: string;
  handleRefresh: () => Promise<void>;
};

export function useDevicesList(instance: InstanceRecord): DevicesListState {
  const [checkStatus, setCheckStatus] = useState<CheckStatus>("idle");
  const [checkError, setCheckError] = useState("");

  const nodes = useQuery(
    api.connected_devices.listByInstance,
    instance.openclawId ? { instanceId: instance.openclawId } : "skip",
  );

  const checkConnectedDevices = useAction(
    api.project_node_operations.checkConnectedDevices,
  );

  async function handleRefresh(): Promise<void> {
    if (!instance.openclawId) return;

    setCheckStatus("checking");
    setCheckError("");

    try {
      const parsed = await checkConnectedDevices({ instanceId: instance.openclawId });

      if (parsed?.ok) {
        setCheckStatus("ok");
      } else {
        setCheckStatus("failed");
        setCheckError(parsed?.error ?? "Failed to check connected devices");
      }
    } catch (error: unknown) {
      setCheckStatus("failed");
      setCheckError(
        error instanceof Error ? error.message : "Failed to check connected devices",
      );
    }
  }

  return {
    nodes,
    checkStatus,
    checkError,
    handleRefresh,
  };
}
