"use client";

import { useEffect } from "react";
import { Link, Plus, RefreshCw, Wifi } from "lucide-react";
import type { InstanceRecord } from "@/src/components/instance-workspace.types";
import { Button } from "@/components/ui/button";
import { useDevicesList } from "./use-devices-list";

export function DevicesList({
  instance,
  onAddDevice,
  onEmpty,
}: {
  instance: InstanceRecord;
  onAddDevice: () => void;
  onEmpty?: () => void;
}) {
  const { nodes, checkStatus, checkError, handleRefresh } = useDevicesList(instance);

  const isChecking = checkStatus === "checking";
  const isLoading = nodes === undefined;

  useEffect(() => {
    if (!isLoading && nodes.length === 0) {
      onEmpty?.();
    }
  }, [isLoading, nodes, onEmpty]);

  return (
    <div className="grid gap-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-[var(--dashboard-ink)]">Devices</h2>
        <Button
          type="button"
          className="h-10 shrink-0 rounded-xl bg-[var(--dashboard-primary)] px-4 text-sm text-[var(--dashboard-on-primary)] hover:bg-[var(--dashboard-primary-container)]"
          onClick={onAddDevice}
        >
          <Plus className="mr-1.5 size-4" />
          Add a device
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-[rgba(0,38,27,0.1)]">
        {/* Table header */}
        <div className="grid grid-cols-[1fr_148px_152px_80px] border-b border-[rgba(0,38,27,0.08)] bg-[rgba(243,244,244,0.6)] px-5 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--dashboard-ink-muted)]">Device</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--dashboard-ink-muted)]">Connected</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--dashboard-ink-muted)]">Last verified</span>
          <span className="text-right text-xs font-semibold uppercase tracking-wide text-[var(--dashboard-ink-muted)]">Actions</span>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 px-5 py-4 text-sm text-[var(--dashboard-ink-muted)]">
            <RefreshCw className="size-4 animate-spin" />
            Loading…
          </div>
        ) : nodes.length === 0 ? (
          <p className="px-5 py-4 text-sm text-[var(--dashboard-ink-muted)]">
            No devices connected yet. Click &ldquo;Add a device&rdquo; to get started.
          </p>
        ) : (
          nodes.map((node) => (
            <div
              key={node.displayName}
              className="grid grid-cols-[1fr_148px_152px_80px] items-center border-b border-[rgba(0,38,27,0.06)] px-5 py-4 last:border-b-0"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[rgba(220,230,224,0.5)]">
                  <Wifi className="size-4 text-[#236949]" />
                </div>
                <p className="text-sm font-medium text-[var(--dashboard-ink)]">
                  {node.displayName || "—"}
                </p>
              </div>
              <span className="text-sm text-[var(--dashboard-ink-muted)]">
                {new Date(node._creationTime).toLocaleString()}
              </span>
              <span className="text-sm text-[var(--dashboard-ink-muted)]">
                {new Date(node.connectedAt).toLocaleString()}
              </span>
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  title="Test connection"
                  disabled={isChecking}
                  className="flex size-8 items-center justify-center rounded-lg text-[var(--dashboard-ink-muted)] hover:bg-[rgba(0,38,27,0.06)] hover:text-[var(--dashboard-primary)] disabled:opacity-40"
                  onClick={() => void handleRefresh()}
                >
                  <RefreshCw className={`size-4 ${isChecking ? "animate-spin" : ""}`} />
                </button>
                <button
                  type="button"
                  title="Generate new link"
                  className="flex size-8 items-center justify-center rounded-lg text-[var(--dashboard-ink-muted)] hover:bg-[rgba(0,38,27,0.06)] hover:text-[var(--dashboard-primary)]"
                  onClick={onAddDevice}
                >
                  <Link className="size-4" />
                </button>
              </div>
            </div>
          ))
        )}

        {checkError ? (
          <p className="border-t border-[rgba(0,38,27,0.06)] px-5 py-3 text-sm text-[#8f3030]">
            {checkError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
