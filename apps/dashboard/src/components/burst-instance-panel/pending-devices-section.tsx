"use client";

import { preClass } from "./styles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PendingDevicesSection({
  pendingDeviceRequests,
  nodeRequestId,
  onNodeRequestIdChange,
  nodeError,
  nodeOutput,
  onListPendingNodes,
  onApproveNode,
}: {
  pendingDeviceRequests: string[];
  nodeRequestId: string;
  onNodeRequestIdChange: (value: string) => void;
  nodeError: string | undefined;
  nodeOutput: string | undefined;
  onListPendingNodes: () => void;
  onApproveNode: (requestId?: string) => void;
}) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Button variant="outline" size="sm"  type="button" onClick={onListPendingNodes}>
          List pending devices
        </Button>
        <Input
          className="w-auto"
          style={{ minWidth: 260 }}
          placeholder="Pending device request id"
          value={nodeRequestId}
          onChange={(event) => onNodeRequestIdChange(event.target.value)}
        />
        <Button variant="outline" size="sm"  type="button" onClick={() => onApproveNode()}>
          Approve
        </Button>
      </div>
      {pendingDeviceRequests.length ? (
        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
          {pendingDeviceRequests.map((requestId) => (
            <div key={requestId} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <code style={{ fontSize: 12 }}>{requestId}</code>
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => onApproveNode(requestId)}
              >
                Approve
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      {nodeError ? <div style={{ color: "var(--status-error)", marginTop: 6, fontSize: 12 }}>{nodeError}</div> : null}
      {nodeOutput ? <pre className={preClass}>{nodeOutput}</pre> : null}
    </div>
  );
}
