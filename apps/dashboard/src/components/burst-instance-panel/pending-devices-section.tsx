"use client";

import { buttonChipClass, inputChipClass, preClass } from "./styles";

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
        <button className={buttonChipClass} type="button" onClick={onListPendingNodes}>
          List pending devices
        </button>
        <input
          className={inputChipClass}
          style={{ minWidth: 260 }}
          placeholder="Pending device request id"
          value={nodeRequestId}
          onChange={(event) => onNodeRequestIdChange(event.target.value)}
        />
        <button className={buttonChipClass} type="button" onClick={() => onApproveNode()}>
          Approve
        </button>
      </div>
      {pendingDeviceRequests.length ? (
        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
          {pendingDeviceRequests.map((requestId) => (
            <div key={requestId} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <code style={{ fontSize: 12 }}>{requestId}</code>
              <button
                className={buttonChipClass}
                type="button"
                onClick={() => onApproveNode(requestId)}
              >
                Approve
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {nodeError ? <div style={{ color: "#9d1f2f", marginTop: 6, fontSize: 12 }}>{nodeError}</div> : null}
      {nodeOutput ? <pre className={preClass}>{nodeOutput}</pre> : null}
    </div>
  );
}
