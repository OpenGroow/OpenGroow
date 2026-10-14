"use client";

import { useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type {
  ConnectSessionStatus,
  ConnectTicketState,
  InstanceRecord,
  ParsedNodesPayload,
} from "@/src/components/instance-workspace.types";
import type { ConnectWizardPhase } from "./wizard-step";

const PENDING_POLL_MS = 3_000;
const STATUS_POLL_MS = 2_000;
// A single failed poll is often a transient network hiccup, not a real
// session failure. Require a few consecutive failures before surfacing an
// error, so a brief glitch doesn't kick the user back to step 1.
const STATUS_FAILURE_THRESHOLD = 3;
const PENDING_FAILURE_THRESHOLD = 3;

type ConnectStatusResponse = {
  status?: number;
  ok?: boolean;
  session?: ConnectSessionStatus;
  error?: string;
};

export function useConnectWizard(instance: InstanceRecord, startFresh = false) {
  const [connectTicket, setConnectTicket] = useState<ConnectTicketState>({});
  const [sessionStatus, setSessionStatus] = useState<ConnectSessionStatus>();
  const [wizardPhase, setWizardPhase] = useState<ConnectWizardPhase>("idle");
  const [wizardError, setWizardError] = useState("");
  const [pendingNodeRequestId, setPendingNodeRequestId] = useState("");
  const [pendingNodeRequestCount, setPendingNodeRequestCount] = useState(0);
  const [pendingRequestInFlight, setPendingRequestInFlight] = useState(false);
  const [approvalSubmitted, setApprovalSubmitted] = useState(false);
  const [approvingDevice, setApprovingDevice] = useState(false);
  const pendingPollStartedRef = useRef(false);
  const statusFailureCountRef = useRef(0);
  const pendingFailureCountRef = useRef(0);

  const [connectedAt, setConnectedAt] = useState<Date | null>(null);
  const [deviceSaveStatus, setDeviceSaveStatus] = useState<
    "idle" | "saving" | "saved" | "failed"
  >("idle");

  const createConnectTicket = useAction(api.connect_tickets_node.createConnectTicket);
  const getLatestActiveTicketForInstance = useAction(api.connect_tickets_node.getLatestActiveTicketForInstance);
  const listPendingNodes = useAction(api.project_node_operations.listPendingNodes);
  const approvePendingNode = useAction(api.project_node_operations.approvePendingNode);
  const confirmConnectedDevices = useAction(
    api.project_node_operations.confirmConnectedDevices,
  );

  async function handleCreateConnectTicket(): Promise<void> {
    if (!instance.openclawId || !instance.openclawGatewayToken?.trim()) {
      const error = "Project id or gateway token missing";
      setConnectTicket({ status: "failed", error });
      setWizardPhase("failed");
      setWizardError(error);
      return;
    }

    setWizardError("");
    setSessionStatus(undefined);
    setWizardPhase("idle");
    setPendingNodeRequestId("");
    setPendingNodeRequestCount(0);
    setPendingRequestInFlight(false);
    setApprovalSubmitted(false);
    pendingPollStartedRef.current = false;
    statusFailureCountRef.current = 0;
    pendingFailureCountRef.current = 0;
    setConnectTicket({ status: "creating" });

    try {
      const data = await createConnectTicket({
        instanceId: instance.openclawId,
        gatewayToken: instance.openclawGatewayToken,
        openclawName: instance.openclawName,
        ipv4: instance.ipv4,
        serverId: instance.openclawServerId,
      });

      if (data.error || !data.ticket) {
        const error = data.error ?? "Failed to create connect ticket";
        setConnectTicket({ status: "failed", error });
        setWizardPhase("failed");
        setWizardError(error);
        return;
      }

      setConnectTicket({ status: "ready", ticket: data.ticket });
      setWizardPhase("ticket_ready");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to create connect ticket";
      setConnectTicket({ status: "failed", error: message });
      setWizardPhase("failed");
      setWizardError(message);
    }
  }

  async function fetchPendingDevices() {
    if (!instance.openclawId) {
      return null;
    }
    return await listPendingNodes({ instanceId: instance.openclawId });
  }

  async function requestPendingDevices(): Promise<void> {
    if (!instance.openclawId || !connectTicket.ticket) {
      return;
    }

    setPendingRequestInFlight(true);

    try {
      const parsed = await fetchPendingDevices();
      if (!parsed) {
        pendingFailureCountRef.current += 1;
        if (pendingFailureCountRef.current < PENDING_FAILURE_THRESHOLD) {
          return;
        }
        setWizardPhase("failed");
        setWizardError("Failed to list pending devices");
        return;
      }
      pendingFailureCountRef.current = 0;
      handlePendingDevicesResult(parsed);
    } catch (error: unknown) {
      pendingFailureCountRef.current += 1;
      if (pendingFailureCountRef.current < PENDING_FAILURE_THRESHOLD) {
        return;
      }
      setWizardPhase("failed");
      setWizardError(
        error instanceof Error ? error.message : "Failed to list pending devices",
      );
    } finally {
      setPendingRequestInFlight(false);
    }
  }

  async function handleApproveDevice(): Promise<void> {
    if (!instance.openclawId) {
      setWizardPhase("failed");
      setWizardError(
        "Project not operational yet. Retry when the runtime id is available.",
      );
      return;
    }

    if (!pendingNodeRequestId) {
      setWizardPhase("failed");
      setWizardError("Missing pending device request id");
      return;
    }

    setApprovingDevice(true);
    try {
      const data = await approvePendingNode({ instanceId: instance.openclawId });
      if (!data.ok) {
        setPendingNodeRequestId(data.requestIds[0] ?? "");
        setPendingNodeRequestCount(data.requestIds.length);
        setWizardPhase("failed");
        setWizardError(data.error ?? "Failed to approve device");
        return;
      }

      setWizardError("");
      setApprovalSubmitted(true);
      handleApproveResult(data);
    } catch (error: unknown) {
      setWizardPhase("failed");
      setWizardError(
        error instanceof Error ? error.message : "Failed to approve device",
      );
    } finally {
      setApprovingDevice(false);
    }
  }

  async function fetchSessionStatus(): Promise<void> {
    const ticket = connectTicket.ticket;
    if (!ticket) {
      return;
    }

    try {
      const response = await fetch(
        `/api/connect-ticket-status?connectUrl=${encodeURIComponent(ticket.connectUrl)}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as ConnectStatusResponse;
      if (!response.ok || !data.session) {
        // Transport-level failure (network hiccup, relay 5xx, a 404 racing
        // ticket propagation, ...): don't treat it as authoritative. Real
        // expiry is already enforced client-side from ticket.expiresAt, and
        // a real session failure is reported via data.session.phase below.
        statusFailureCountRef.current += 1;
        if (statusFailureCountRef.current < STATUS_FAILURE_THRESHOLD) {
          return;
        }
        const error = data.error ?? "Failed to fetch connect ticket status";
        setWizardPhase("failed");
        setWizardError(error);
        return;
      }

      statusFailureCountRef.current = 0;
      setSessionStatus(data.session);

      if (data.session.phase === "expired") {
        setWizardPhase("expired");
        return;
      }

      if (data.session.phase === "failed") {
        setWizardPhase("failed");
        setWizardError(data.session.error ?? "Connect session failed");
        return;
      }

      if (data.session.phase === "connected") {
        // Don't jump straight to "connected" from the initial phases: the
        // relay can show "connected" from a stale session while a new device
        // is waiting for approval. Let the pending devices polling decide
        // whether to move to "connected" or stay at step 3 (approval_required).
        if (wizardPhase === "ticket_ready" || wizardPhase === "waiting_for_device") {
          if (wizardPhase === "ticket_ready") {
            setWizardPhase("waiting_for_device");
          }
          return;
        }
        // If we're in approval_required without having submitted the approval,
        // also block the transition (re-approval in progress after a test).
        if (wizardPhase === "approval_required" && !approvalSubmitted) {
          return;
        }
        // The underlying WS session can stay "connected" at the relay level
        // even though the gateway still requires a *second*, separate
        // approval round for this same node (a scope upgrade granting its
        // actual capabilities) — the WS doesn't get closed for that, so the
        // relay's "connected" report alone can't be trusted once the first
        // approval has already been submitted. Re-check for a fresh pending
        // request before finalizing, instead of handing off to DevicesList
        // with a device that has no capabilities yet.
        if (wizardPhase !== "connected" && approvalSubmitted) {
          const parsed = await fetchPendingDevices();
          if (parsed?.ok && parsed.requestIds.length >= 1) {
            setPendingNodeRequestId(parsed.requestIds[0] ?? "");
            setPendingNodeRequestCount(parsed.requestIds.length);
            setApprovalSubmitted(false);
            setWizardPhase("approval_required");
            return;
          }
        }
        setWizardPhase("connected");
        return;
      }

      if (wizardPhase === "reconnecting") {
        return;
      }

      if (data.session.phase === "approval_required") {
        setWizardPhase("approval_required");
        return;
      }

      if (data.session.phase === "reconnecting" && approvalSubmitted) {
        setWizardPhase("reconnecting");
        return;
      }

      if (wizardPhase === "ticket_ready") {
        setWizardPhase("waiting_for_device");
      }
    } catch (error: unknown) {
      statusFailureCountRef.current += 1;
      if (statusFailureCountRef.current < STATUS_FAILURE_THRESHOLD) {
        return;
      }
      setWizardPhase("failed");
      setWizardError(
        error instanceof Error
          ? error.message
          : "Failed to fetch connect ticket status",
      );
    }
  }

  function handlePendingDevicesResult(parsed: ParsedNodesPayload | null): void {
    if (!parsed) {
      setWizardPhase("failed");
      setWizardError("Unexpected runtime result");
      return;
    }

    if (!parsed.ok) {
      setWizardPhase("failed");
      setWizardError(parsed.error ?? "Runtime node command failed");
      return;
    }

    if (parsed.requestIds.length > 1) {
      setPendingNodeRequestCount(parsed.requestIds.length);
      setWizardPhase("failed");
      setWizardError(
        "Multiple pending devices detected. Stop extra helpers and create a new connect link.",
      );
      return;
    }

    if (parsed.requestIds.length === 1) {
      setPendingNodeRequestCount(1);
      setPendingNodeRequestId(parsed.requestIds[0] ?? "");
      setWizardPhase("approval_required");
      return;
    }

    setPendingNodeRequestCount(0);
    // If the relay reports "connected" and there's no device pending,
    // the connection is healthy — go straight to "connected".
    if (sessionStatus?.phase === "connected") {
      setWizardPhase("connected");
    } else if (wizardPhase === "ticket_ready") {
      setWizardPhase("waiting_for_device");
    }
  }

  function handleApproveResult(data: ParsedNodesPayload): void {
    if (!data.ok) {
      setWizardPhase("failed");
      setWizardError(data.error ?? "Failed to approve device");
      return;
    }

    setPendingNodeRequestCount(0);
    setPendingNodeRequestId("");
    setWizardPhase("reconnecting");
  }

  useEffect(() => {
    if (startFresh || !instance.openclawId || wizardPhase !== "idle") return;
    let cancelled = false;
    void getLatestActiveTicketForInstance({ instanceId: instance.openclawId }).then((data) => {
      if (!cancelled && data.ok && data.ticket) {
        setConnectTicket({ status: "ready", ticket: data.ticket });
        setWizardPhase("ticket_ready");
      }
    });
    return () => { cancelled = true; };
  }, [instance.openclawId, wizardPhase]);

  useEffect(() => {
    if (!connectTicket.ticket || wizardPhase === "connected") {
      return;
    }

    const expiresAtMs = Date.parse(connectTicket.ticket.expiresAt);
    if (expiresAtMs <= Date.now()) {
      setWizardPhase("expired");
      return;
    }

    const delay = expiresAtMs - Date.now();
    // window.setTimeout uses a 32-bit signed integer; delays beyond ~24.8 days
    // overflow and fire immediately. Tickets with no expiry use a far-future
    // sentinel date — skip the timer and let them stay active indefinitely.
    if (delay > 2_147_483_647) {
      return;
    }

    const timer = window.setTimeout(() => {
      setWizardPhase((current) =>
        current === "connected" ? current : "expired",
      );
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [approvalSubmitted, connectTicket.ticket, wizardPhase]);

  useEffect(() => {
    if (
      !connectTicket.ticket ||
      wizardPhase === "idle" ||
      wizardPhase === "failed" ||
      wizardPhase === "expired" ||
      wizardPhase === "connected"
    ) {
      return;
    }

    void fetchSessionStatus();
    const interval = window.setInterval(() => {
      void fetchSessionStatus();
    }, STATUS_POLL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [connectTicket.ticket, wizardPhase]);

  useEffect(() => {
    if (
      !connectTicket.ticket ||
      !(
        wizardPhase === "ticket_ready" ||
        wizardPhase === "waiting_for_device" ||
        (wizardPhase === "approval_required" &&
          !pendingNodeRequestId &&
          !approvalSubmitted)
      ) ||
      pendingRequestInFlight
    ) {
      return;
    }

    const delay = pendingPollStartedRef.current ? PENDING_POLL_MS : 0;
    pendingPollStartedRef.current = true;
    const timer = window.setTimeout(() => {
      void requestPendingDevices();
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    approvalSubmitted,
    connectTicket.ticket,
    pendingRequestInFlight,
    pendingNodeRequestId,
    wizardPhase,
  ]);

  useEffect(() => {
    if (wizardPhase === "connected" && connectedAt === null) {
      setConnectedAt(new Date());
      if (instance.openclawId) {
        setDeviceSaveStatus("saving");
        void confirmConnectedDevices({ instanceId: instance.openclawId })
          .then((confirmed) => setDeviceSaveStatus(confirmed ? "saved" : "failed"))
          .catch(() => {
            // sauvegarde best-effort : on debloque quand meme la redirection
            setDeviceSaveStatus("failed");
          });
      } else {
        setDeviceSaveStatus("saved");
      }
    }
  }, [wizardPhase, connectedAt]);

  return {
    approvalSubmitted,
    approvingDevice,
    connectedAt,
    connectTicket,
    deviceSaveStatus,
    handleApproveDevice,
    handleCreateConnectTicket,
    pendingNodeRequestCount,
    pendingNodeRequestId,
    sessionStatus,
    wizardError,
    wizardPhase,
  };
}
