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
        <h2 className="text-xl font-semibold text-foreground">Devices</h2>
        <Button size="lg"
          type="button"
          className="shrink-0"
          onClick={onAddDevice}
        >
          <Plus className="mr-1.5 size-4" />
          Add a device
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border">
        {/* Table header */}
        <div className="grid grid-cols-[1fr_148px_152px_80px] border-b border-border bg-muted/50 px-5 py-2.5">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground">Device</span>
          <span className="text-xs font-semibold tracking-wide text-muted-foreground">Connected</span>
          <span className="text-xs font-semibold tracking-wide text-muted-foreground">Last verified</span>
          <span className="text-right text-xs font-semibold tracking-wide text-muted-foreground">Actions</span>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 px-5 py-4 text-sm text-muted-foreground">
            <RefreshCw className="size-4 animate-spin" />
            Loading…
          </div>
        ) : nodes.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">
            No devices connected yet. Click &ldquo;Add a device&rdquo; to get started.
          </p>
        ) : (
          nodes.map((node) => (
            <div
              key={node.displayName}
              className="grid grid-cols-[1fr_148px_152px_80px] items-center border-b border-border px-5 py-4 last:border-b-0"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
                  <Wifi className="size-4 text-status-success" />
                </div>
                <p className="text-sm font-medium text-foreground">
                  {node.displayName || "—"}
                </p>
              </div>
              <span className="text-sm text-muted-foreground">
                {new Date(node._creationTime).toLocaleString()}
              </span>
              <span className="text-sm text-muted-foreground">
                {new Date(node.connectedAt).toLocaleString()}
              </span>
              <div className="flex justify-end gap-1.5">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  title="Test connection"
                  disabled={isChecking}
                  onClick={() => void handleRefresh()}
                >
                  <RefreshCw className={`size-4 ${isChecking ? "animate-spin" : ""}`} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  title="Generate new link"
                  onClick={onAddDevice}
                >
                  <Link className="size-4" />
                </Button>
              </div>
            </div>
          ))
        )}

        {checkError ? (
          <p className="border-t border-border px-5 py-3 text-sm text-destructive">
            {checkError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
