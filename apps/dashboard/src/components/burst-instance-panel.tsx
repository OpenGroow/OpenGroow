"use client";

import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api.js";
import type { ProviderAuthActions } from "@/src/hooks/use-provider-auth";
import { AiConfigSection } from "./burst-instance-panel/ai-config-section";
import { ConnectTicketSection } from "./burst-instance-panel/connect-ticket-section";
import { CreateInstanceControls } from "./burst-instance-panel/create-instance-controls";
import { InstanceAuthSection } from "./burst-instance-panel/instance-auth-section";
import { OpenClawExecSection } from "./burst-instance-panel/openclaw-exec-section";
import { PendingDevicesSection } from "./burst-instance-panel/pending-devices-section";
import {
  buttonChipClass,
  inputChipClass,
  mutedClass,
  panelClass,
  preClass,
  sectionClass,
} from "./burst-instance-panel/styles";
import { TelegramSection } from "./burst-instance-panel/telegram-section";
import type { ApiResponse, ConnectTicketState } from "./burst-instance-panel/types";
import { WhatsAppSection } from "./burst-instance-panel/whatsapp-section";

const WHATSAPP_PAIR_START_TIMEOUT_MS = 30_000;
const WHATSAPP_PAIR_WAIT_TIMEOUT_MS = 15_000;

type BurstInstancePanelProps = {
  instanceId?: string;
};

function isWhatsAppQrExpiredMessage(output: string | undefined): boolean {
  const normalized = output?.toLowerCase() ?? "";
  return (
    normalized.includes("status=408") ||
    normalized.includes("request time-out qr refs attempts ended") ||
    normalized.includes("login qr expired") ||
    normalized.includes("generate a new qr")
  );
}

export function BurstInstancePanel({ instanceId }: BurstInstancePanelProps) {
  const createJob = useAction(api.instances_node.createJob);
  const refreshJob = useAction(api.instances_node.refreshJob);
  const removeInstanceFromInfra = useAction(api.instances_node.removeInstance);
  const destroyAllInstances = useAction(api.instances_node.destroyAllInstances);
  const rollout = useAction(api.instances_node.rollout);
  const listPendingNodes = useAction(api.project_node_operations.listPendingNodes);
  const approvePendingNode = useAction(api.project_node_operations.approvePendingNode);
  const configureWhatsApp = useAction(api.project_channel_operations.configureWhatsApp);
  const configureTelegram = useAction(api.project_channel_operations.configureTelegram);
  const startWhatsAppPairing = useAction(api.project_channel_operations.startWhatsAppPairing);
  const waitWhatsAppPairing = useAction(api.project_channel_operations.waitWhatsAppPairing);
  const configureAiProvider = useAction(api.project_provider_operations.configureAiProvider);
  const executeDeveloperCommand = useAction(api.project_provider_operations.executeDeveloperCommand);
  const createConnectTicket = useAction(api.connect_tickets_node.createConnectTicket);
  const providerAuthActions: ProviderAuthActions = {
    startAuth: useAction(api.auth_node.startAuth),
    getAuthJob: useAction(api.auth_node.getAuthJob),
    sendAuthInput: useAction(api.auth_node.sendAuthInput),
    cancelAuth: useAction(api.auth_node.cancelAuth),
  };
  const instances = useQuery(api.instances.list) as
    | Array<{
        _id: string;
        jobId: string;
        openclawName?: string;
        openclawId?: string;
        openclawServerId?: number;
        ipv4?: string;
        openclawGatewayToken?: string;
        updatedAt?: string;
      }>
    | undefined;
  const visibleInstances = instanceId
    ? instances?.filter(
        (instance) =>
          instance.openclawId === instanceId || instance.jobId === instanceId,
      )
    : instances;
  const isScopedToInstance = !!instanceId;
  const [nameSuffix, setNameSuffix] = useState("");
  const [openClawImageRef, setOpenClawImageRef] = useState("");
  const [jobId, setJobId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [nodeOutput, setNodeOutput] = useState<Record<string, string>>({});
  const [nodeError, setNodeError] = useState<Record<string, string>>({});
  const [nodeRequestIds, setNodeRequestIds] = useState<Record<string, string>>({});
  const [nodePendingRequests, setNodePendingRequests] = useState<Record<string, string[]>>({});
  const [whatsAppPairing, setWhatsAppPairing] = useState<
    Record<string, { status?: string; output?: string; qrDataUrl?: string; linked?: boolean; connected?: boolean; error?: string }>
  >({});
  const [whatsAppNumbers, setWhatsAppNumbers] = useState<Record<string, string>>({});
  const [whatsAppConfig, setWhatsAppConfig] = useState<
    Record<string, { status?: string; output?: string; error?: string; phoneNumber?: string }>
  >({});
  const [whatsAppAutoCheckUntil, setWhatsAppAutoCheckUntil] = useState<Record<string, number>>({});
  const [telegramConfig, setTelegramConfig] = useState<
    Record<string, { status?: string; output?: string; error?: string }>
  >({});
  const [telegramBotTokens, setTelegramBotTokens] = useState<Record<string, string>>({});
  const [aiConfig, setAiConfig] = useState<
    Record<string, { status?: string; output?: string; error?: string; provider?: string; model?: string }>
  >({});
  const [aiProviders, setAiProviders] = useState<Record<string, string>>({});
  const [aiApiKeys, setAiApiKeys] = useState<Record<string, string>>({});
  const [aiModels, setAiModels] = useState<Record<string, string>>({});
  const [openClawCommands, setOpenClawCommands] = useState<Record<string, string>>({});
  const [openClawCommandResults, setOpenClawCommandResults] = useState<
    Record<string, { status?: string; output?: string; error?: string; exitCode?: number | null }>
  >({});
  const [connectTickets, setConnectTickets] = useState<Record<string, ConnectTicketState>>({});

  function getInstanceKey(instance: {
    _id: string;
    openclawServerId?: number;
    ipv4?: string;
  }): string {
    return String(instance.openclawServerId ?? instance.ipv4 ?? instance._id);
  }

  const gatewayToken = result?.job?.openclaw?.gatewayToken ?? "";
  const openclawIpv4 = result?.job?.openclaw?.ipv4 ?? "";
  const openclawName = result?.job?.openclaw?.name ?? "";

  async function submit(): Promise<void> {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = (await createJob({
        nameSuffix: nameSuffix.trim() || undefined,
        openClawImageRef: openClawImageRef.trim() || undefined
      })) as ApiResponse;
      if (data.error) {
        setError(data.error);
      } else {
        setResult(data);
        const newId = data.job?.id;
        if (newId) {
          setJobId(newId);
          setAutoRefresh(true);
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown request error");
    } finally {
      setLoading(false);
    }
  }

  async function refresh(): Promise<void> {
    if (!jobId.trim()) {
      setError("Job ID required to refresh");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = (await refreshJob({ jobId: jobId.trim() })) as ApiResponse;
      if (data.error) {
        setError(data.error);
      } else {
        setResult(data);
        setAutoRefresh(true);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown request error");
    } finally {
      setLoading(false);
    }
  }

  async function runRollout(refreshCompose = false): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const data = (await rollout({
        openClawImageRef: openClawImageRef.trim() || undefined,
        refreshCompose
      })) as ApiResponse;
      if (data.error) {
        setError(data.error);
      } else {
        setResult(data);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown request error");
    } finally {
      setLoading(false);
    }
  }

  async function runListPendingNodes(instanceId?: string, serverId?: number, ipv4?: string): Promise<void> {
    const key = String(serverId ?? ipv4 ?? instanceId ?? "unknown");
    if (!instanceId) {
      setNodeError((prev) => ({
        ...prev,
        [key]: "Project not operational yet. Retry once the runtime is available."
      }));
      return;
    }
    try {
      const data = await listPendingNodes({ instanceId });
      if (!data.ok) {
        setNodeError((prev) => ({
          ...prev,
          [key]: data.error ?? "Failed to list pending devices"
        }));
        setNodePendingRequests((prev) => ({ ...prev, [key]: [] }));
        return;
      }
      setNodeError((prev) => ({ ...prev, [key]: "" }));
      setNodeOutput((prev) => ({ ...prev, [key]: data.output }));
      setNodePendingRequests((prev) => ({ ...prev, [key]: data.requestIds }));
      setNodeRequestIds((prev) => ({ ...prev, [key]: data.requestIds[0] ?? "" }));
    } catch (e: unknown) {
      setNodeError((prev) => ({
        ...prev,
        [key]: e instanceof Error ? e.message : "Failed to list pending devices"
      }));
      setNodePendingRequests((prev) => ({ ...prev, [key]: [] }));
    }
  }

  async function runApproveNode(
    instanceId?: string,
    serverId?: number,
    ipv4?: string,
    providedRequestId?: string
  ): Promise<void> {
    const key = String(serverId ?? ipv4 ?? instanceId ?? "unknown");
    if (!instanceId) {
      setNodeError((prev) => ({
        ...prev,
        [key]: "Project not operational yet. Retry once the runtime is available."
      }));
      return;
    }
    try {
      const data = await approvePendingNode({ instanceId });
      if (!data.ok) {
        setNodeError((prev) => ({ ...prev, [key]: data.error ?? "Failed to approve device" }));
        return;
      }
      setNodeError((prev) => ({ ...prev, [key]: "" }));
      setNodeOutput((prev) => ({ ...prev, [key]: data.output }));
      setNodePendingRequests((prev) => ({ ...prev, [key]: [] }));
      setNodeRequestIds((prev) => ({ ...prev, [key]: "" }));
    } catch (e: unknown) {
      setNodeError((prev) => ({
        ...prev,
        [key]: e instanceof Error ? e.message : "Failed to approve device"
      }));
    }
  }

  async function runWhatsAppPairStart(
    instanceId?: string,
    serverId?: number,
    ipv4?: string,
    force = false
  ): Promise<void> {
    const key = String(serverId ?? ipv4 ?? instanceId ?? "unknown");
    if (!instanceId) {
      setWhatsAppPairing((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? {}), status: "failed", error: "OpenClaw id missing for this Project" }
      }));
      return;
    }
    try {
      setWhatsAppPairing((prev) => ({
        ...prev,
        [key]: {
          status: force ? "restarting" : "starting",
          output: "",
          qrDataUrl: undefined,
          linked: false,
          connected: false,
          error: undefined
        }
      }));
      const data = await startWhatsAppPairing({
        instanceId,
        force,
        timeoutMs: WHATSAPP_PAIR_START_TIMEOUT_MS
      });
      applyWhatsAppPairResult(key, data, "start", instanceId, serverId, ipv4);
      setWhatsAppAutoCheckUntil((prev) => ({
        ...prev,
        [key]: Date.now() + 3 * 60_000
      }));
    } catch (e: unknown) {
      setWhatsAppPairing((prev) => ({
        ...prev,
        [key]: {
          ...(prev[key] ?? {}),
          status: "failed",
          error: e instanceof Error ? e.message : "Failed to start WhatsApp pairing"
        }
      }));
    }
  }

  async function runWhatsAppPairWait(instanceId?: string, serverId?: number, ipv4?: string): Promise<void> {
    const key = String(serverId ?? ipv4 ?? instanceId ?? "unknown");
    if (!instanceId) {
      setWhatsAppPairing((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? {}), status: "failed", error: "OpenClaw id missing for this Project" }
      }));
      return;
    }
    try {
      setWhatsAppPairing((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? {}), status: "checking", error: undefined }
      }));
      const data = await waitWhatsAppPairing({
        instanceId,
        timeoutMs: WHATSAPP_PAIR_WAIT_TIMEOUT_MS
      });
      applyWhatsAppPairResult(key, data, "wait", instanceId, serverId, ipv4);
    } catch (e: unknown) {
      setWhatsAppPairing((prev) => ({
        ...prev,
        [key]: {
          ...(prev[key] ?? {}),
          status: "failed",
          error: e instanceof Error ? e.message : "Failed to check WhatsApp link"
        }
      }));
    }
  }

  function applyWhatsAppPairResult(
    key: string,
    parsed: {
      ok: boolean;
      output: string;
      linked: boolean;
      connected: boolean;
      qrDataUrl?: string;
      error?: string;
    },
    phase: "start" | "wait",
    instanceId?: string,
    serverId?: number,
    ipv4?: string,
  ): void {
    const clearQr =
      parsed.connected ||
      parsed.linked ||
      !parsed.ok ||
      isWhatsAppQrExpiredMessage(parsed.output) ||
      isWhatsAppQrExpiredMessage(parsed.error);
    setWhatsAppPairing((prev) => ({
      ...prev,
      [key]: {
        status: parsed.ok
          ? parsed.connected
            ? "connected"
            : parsed.linked
              ? "linked"
              : phase === "start"
                ? "qr_ready"
                : "waiting_scan"
          : "failed",
        output: parsed.output,
        qrDataUrl: clearQr ? undefined : parsed.qrDataUrl,
        linked: parsed.linked,
        connected: parsed.connected,
        error: parsed.ok ? undefined : parsed.error,
      },
    }));
    if (parsed.connected || parsed.linked) {
      setWhatsAppAutoCheckUntil((prev) => ({ ...prev, [key]: 0 }));
      return;
    }
    if (parsed.ok && instanceId && (whatsAppAutoCheckUntil[key] ?? 0) > Date.now()) {
      window.setTimeout(() => {
        void runWhatsAppPairWait(instanceId, serverId, ipv4);
      }, parsed.qrDataUrl ? 1500 : 2500);
      return;
    }
    if ((whatsAppAutoCheckUntil[key] ?? 0) <= Date.now()) {
      setWhatsAppPairing((prev) => ({
        ...prev,
        [key]: {
          ...(prev[key] ?? {}),
          status: "failed",
          qrDataUrl: undefined,
          error: "WhatsApp QR expired. Generate a new QR and scan immediately.",
        },
      }));
      setWhatsAppAutoCheckUntil((prev) => ({ ...prev, [key]: 0 }));
    }
  }

  async function runWhatsAppConfigSet(
    instanceId?: string,
    serverId?: number,
    ipv4?: string,
    phoneNumber?: string
  ): Promise<void> {
    const key = String(serverId ?? ipv4 ?? instanceId ?? "unknown");
    if (whatsAppConfig[key]?.status === "saving") {
      return;
    }
    if (!instanceId) {
      setWhatsAppConfig((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? {}), status: "failed", error: "OpenClaw id missing for this Project" }
      }));
      return;
    }
    const trimmed = phoneNumber?.trim() ?? "";
    if (trimmed && !/^\+[1-9]\d{5,19}$/.test(trimmed)) {
      setWhatsAppConfig((prev) => ({
        ...prev,
        [key]: {
          ...(prev[key] ?? {}),
          status: "failed",
          error: "Use E.164 format, for example +33612345678"
        }
      }));
      return;
    }
    setWhatsAppConfig((prev) => ({
      ...prev,
      [key]: {
        status: "saving",
        output: "",
        error: undefined
      }
    }));
    try {
      const data = await configureWhatsApp({
        instanceId,
        phoneNumber: trimmed
      });
      setWhatsAppConfig((prev) => ({
        ...prev,
        [key]: {
          status: data.ok ? "saved" : "failed",
          output: data.output,
          error: data.ok ? undefined : data.error,
          phoneNumber: data.phoneNumber
        }
      }));
      if (data.phoneNumber !== undefined) {
        setWhatsAppNumbers((prev) => ({ ...prev, [key]: data.phoneNumber ?? "" }));
      }
    } catch (e: unknown) {
      setWhatsAppConfig((prev) => ({
        ...prev,
        [key]: {
          ...(prev[key] ?? {}),
          status: "failed",
          error: e instanceof Error ? e.message : "Failed to save WhatsApp config"
        }
      }));
    }
  }

  async function runTelegramConfigSet(instanceId?: string, serverId?: number, ipv4?: string, botToken?: string): Promise<void> {
    const key = String(serverId ?? ipv4 ?? instanceId ?? "unknown");
    const trimmed = botToken?.trim() ?? "";
    if (!trimmed) {
      setTelegramConfig((prev) => ({ ...prev, [key]: { status: "error", error: "Bot token is required" } }));
      return;
    }
    if (!instanceId) {
      setTelegramConfig((prev) => ({ ...prev, [key]: { status: "error", error: "Project not connected yet" } }));
      return;
    }
    setTelegramConfig((prev) => ({ ...prev, [key]: { status: "saving" } }));
    try {
      const data = await configureTelegram({ instanceId, botToken: trimmed, dmPolicy: "open" });
      setTelegramConfig((prev) => ({
        ...prev,
        [key]: {
          status: data.ok ? "saved" : "error",
          output: data.output || "Telegram bot token saved.",
          error: data.ok ? undefined : data.error,
        }
      }));
    } catch (e: unknown) {
      setTelegramConfig((prev) => ({
        ...prev,
        [key]: { status: "error", error: e instanceof Error ? e.message : "Failed to save Telegram config" }
      }));
    }
  }

  async function runAiConfigSet(instanceId?: string, serverId?: number, ipv4?: string): Promise<void> {
    const key = String(serverId ?? ipv4 ?? instanceId ?? "unknown");
    const provider = (aiProviders[key] ?? "").trim();
    const apiKey = (aiApiKeys[key] ?? "").trim();
    const model = (aiModels[key] ?? "").trim();
    if (!provider || !apiKey || !model) {
      setAiConfig((prev) => ({ ...prev, [key]: { status: "error", error: "Provider, API key and model are required" } }));
      return;
    }
    if (!instanceId) {
      setAiConfig((prev) => ({ ...prev, [key]: { status: "error", error: "Project not connected yet" } }));
      return;
    }
    setAiConfig((prev) => ({ ...prev, [key]: { status: "saving" } }));
    try {
      const data = await configureAiProvider({ instanceId, provider, apiKey, model });
      if (!data.ok) throw new Error(data.error ?? "Failed to save AI config");
      setAiConfig((prev) => ({
        ...prev,
        [key]: { status: "saved", output: data.output || `${provider === "anthropic" ? "Anthropic" : "OpenAI"} configured.`, provider, model }
      }));
    } catch (e: unknown) {
      setAiConfig((prev) => ({
        ...prev,
        [key]: { status: "error", error: e instanceof Error ? e.message : "Failed to save AI config" }
      }));
    }
  }

  async function runOpenClawExec(
    instanceId?: string,
    serverId?: number,
    ipv4?: string,
    commandText?: string
  ): Promise<void> {
    const key = String(serverId ?? ipv4 ?? instanceId ?? "unknown");
    const trimmed = commandText?.trim() ?? "";
    if (openClawCommandResults[key]?.status === "running") {
      return;
    }
    if (!instanceId) {
      setOpenClawCommandResults((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? {}), status: "failed", error: "OpenClaw id missing for this Project" }
      }));
      return;
    }
    if (!trimmed) {
      setOpenClawCommandResults((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? {}), status: "failed", error: "OpenClaw command is required" }
      }));
      return;
    }

    setOpenClawCommandResults((prev) => ({
      ...prev,
      [key]: {
        status: "running",
        output: "",
        error: undefined,
        exitCode: undefined
      }
    }));

    try {
      const data = await executeDeveloperCommand({
        instanceId,
        commandText: trimmed,
        timeoutMs: 30_000
      });
      setOpenClawCommandResults((prev) => ({
        ...prev,
        [key]: {
          status: data.ok ? "done" : "failed",
          output: data.output,
          error: data.ok ? undefined : data.error,
          exitCode: data.exitCode,
        }
      }));
    } catch (e: unknown) {
      setOpenClawCommandResults((prev) => ({
        ...prev,
        [key]: {
          ...(prev[key] ?? {}),
          status: "failed",
          error: e instanceof Error ? e.message : "Failed to run OpenClaw command"
        }
      }));
    }
  }

  async function runCreateConnectTicket(instance: {
    _id: string;
    openclawId?: string;
    openclawServerId?: number;
    openclawGatewayToken?: string;
    openclawName?: string;
    ipv4?: string;
  }): Promise<void> {
    const key = getInstanceKey(instance);
    const instanceId = instance.openclawId?.trim() ?? "";
    const gatewayToken = instance.openclawGatewayToken?.trim() ?? "";
    if (!instanceId || !gatewayToken) {
      setConnectTickets((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? {}), status: "failed", error: "Project id or gateway token missing" }
      }));
      return;
    }
    setConnectTickets((prev) => ({
      ...prev,
      [key]: { status: "creating", error: undefined }
    }));
    try {
      const data = (await createConnectTicket({
        instanceId,
        gatewayToken,
        openclawName: instance.openclawName,
        ipv4: instance.ipv4,
        serverId: instance.openclawServerId
      })) as {
        ok?: boolean;
        error?: string;
        ticket?: ConnectTicketState["ticket"];
      };
      if (data.error || !data.ticket) {
        setConnectTickets((prev) => ({
          ...prev,
          [key]: { status: "failed", error: data.error ?? "Failed to create connect ticket" }
        }));
        return;
      }
      setConnectTickets((prev) => ({
        ...prev,
        [key]: { status: "ready", ticket: data.ticket }
      }));
    } catch (e: unknown) {
      setConnectTickets((prev) => ({
        ...prev,
        [key]: { status: "failed", error: e instanceof Error ? e.message : "Failed to create connect ticket" }
      }));
    }
  }

  async function removeInstance(jobIdToDelete: string): Promise<void> {
    if (!jobIdToDelete) {
      return;
    }
    try {
      const data = (await removeInstanceFromInfra({ jobId: jobIdToDelete })) as {
        ok?: boolean;
        status?: number;
        serverDeleted?: boolean;
        error?: string;
      };
      if (data.error) {
        setError(data.error);
        return;
      }
      if (data.ok !== true || data.serverDeleted !== true) {
        setError("Project delete failed");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete Project");
    }
  }

  async function destroyAll(): Promise<void> {
    const confirmed = window.confirm("Destroy all Projects from the control plane and Convex?");
    if (!confirmed) {
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const data = (await destroyAllInstances({})) as {
        ok?: boolean;
        status?: number;
        attempted?: number;
        destroyed?: number;
        failed?: number;
        results?: Array<{ jobId: string; ok: boolean; error?: string }>;
        error?: string;
      };
      if (data.error) {
        setError(data.error);
        return;
      }
      if (data.ok !== true) {
        const failures =
          data.results
            ?.filter((item) => item.ok !== true)
            .map((item) => `${item.jobId || "unknown"}: ${item.error ?? "delete failed"}`)
            .join("\n") ?? "Destroy all failed";
        setError(failures);
      }
      setResult({
        status: data.status ?? 200,
        destroyed: data.destroyed,
        attempted: data.attempted,
        failed: data.failed,
        ok: data.ok
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to destroy Projects");
    } finally {
      setLoading(false);
    }
  }

  async function refreshInstance(jobIdToRefresh: string): Promise<void> {
    if (!jobIdToRefresh) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = (await refreshJob({ jobId: jobIdToRefresh })) as ApiResponse;
      if (data.error) {
        setError(data.error);
      } else {
        setResult(data);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown request error");
    } finally {
      setLoading(false);
    }
  }


  useEffect(() => {
    if (!autoRefresh || !jobId.trim()) {
      return;
    }
    let cancelled = false;
    const interval = setInterval(() => {
      void (async () => {
        try {
          const data = (await refreshJob({ jobId: jobId.trim() })) as ApiResponse;
          if (cancelled) {
            return;
          }
          if (data.error) {
            setError(data.error);
            setAutoRefresh(false);
            return;
          }
          setResult(data);
          const status = data.job?.status;
          if (status && status !== "running" && status !== "queued") {
            setAutoRefresh(false);
          }
        } catch (e: unknown) {
          if (cancelled) {
            return;
          }
          setError(e instanceof Error ? e.message : "Unknown request error");
          setAutoRefresh(false);
        }
      })();
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [autoRefresh, jobId, refreshJob]);

  return (
    <section className={sectionClass}>
      <h2 className="mt-0 text-xl font-semibold text-stone-900">
        {isScopedToInstance ? "Project Controls" : "Burst Projects"}
      </h2>
      <p className={mutedClass}>
        {isScopedToInstance
          ? "Advanced controls for this specific OpenClaw project."
          : "Create OpenClaw projects via the control plane (auto broker/network)."}
      </p>
      {!isScopedToInstance ? (
        <CreateInstanceControls
          nameSuffix={nameSuffix}
          onNameSuffixChange={setNameSuffix}
          openClawImageRef={openClawImageRef}
          onOpenClawImageRefChange={setOpenClawImageRef}
          jobId={jobId}
          onJobIdChange={setJobId}
          loading={loading}
          onSubmit={() => void submit()}
          onRefresh={() => void refresh()}
          onRollout={(refreshCompose) => void runRollout(refreshCompose)}
          onDestroyAll={() => void destroyAll()}
        />
      ) : null}

      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      {!isScopedToInstance && gatewayToken ? (
        <div className={panelClass}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <strong>Gateway Token</strong>
            <code style={{ fontSize: 12 }}>{gatewayToken}</code>
            <button
              className={buttonChipClass}
              onClick={() => void navigator.clipboard.writeText(gatewayToken)}
              type="button"
            >
              Copy
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
            {openclawName ? <span>Project: {openclawName} </span> : null}
            {openclawIpv4 ? <span>IPv4: {openclawIpv4}</span> : null}
          </div>
        </div>
      ) : null}
      {result ? (
        <pre className={preClass}>
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : null}
      {visibleInstances && visibleInstances.length ? (
        <div className={panelClass}>
          <strong>{isScopedToInstance ? "Selected Project" : "Latest Projects"}</strong>
          {visibleInstances.map((instance) => {
            const instanceKey = getInstanceKey(instance);
            const pendingDeviceRequests = nodePendingRequests[instanceKey] ?? [];
            return (
              <div key={instance._id} style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, opacity: 0.8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {instance.openclawName ? <span>{instance.openclawName}</span> : <span>OpenClaw</span>}
                  {instance.ipv4 ? <span>IPv4: {instance.ipv4}</span> : null}
                  <span>Job: {instance.jobId.slice(0, 8)}</span>
                  {jobId.trim() && instance.jobId === jobId.trim() ? (
                    <span style={{ color: "#1e7f5c" }}>(current)</span>
                  ) : null}
                </div>
                {instance.openclawGatewayToken ? (
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <code style={{ fontSize: 12 }}>{instance.openclawGatewayToken}</code>
                    <button
                      className={buttonChipClass}
                      onClick={() => void navigator.clipboard.writeText(instance.openclawGatewayToken ?? "")}
                      type="button"
                    >
                      Copy token
                    </button>
                    <button
                      className={buttonChipClass}
                      type="button"
                      onClick={() => void runCreateConnectTicket(instance)}
                    >
                      Create connect link
                    </button>
                    <button
                      className={buttonChipClass}
                      type="button"
                      onClick={() => void refreshInstance(instance.jobId)}
                      disabled={loading}
                    >
                      Refresh
                    </button>
                    <button
                      className={buttonChipClass}
                      type="button"
                      onClick={() => void removeInstance(instance.jobId)}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, opacity: 0.6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span>Gateway token not available yet.</span>
                    <button
                      className={buttonChipClass}
                      type="button"
                      onClick={() => void refreshInstance(instance.jobId)}
                      disabled={loading}
                    >
                      Refresh
                    </button>
                    <button
                      className={buttonChipClass}
                      type="button"
                      onClick={() => void removeInstance(instance.jobId)}
                    >
                      Remove
                    </button>
                  </div>
                )}
                <ConnectTicketSection connectState={connectTickets[instanceKey]} />
                {instance.openclawServerId || instance.ipv4 ? (
                  <PendingDevicesSection
                    pendingDeviceRequests={pendingDeviceRequests}
                    nodeRequestId={nodeRequestIds[instanceKey] ?? ""}
                    onNodeRequestIdChange={(value) =>
                      setNodeRequestIds((prev) => ({ ...prev, [instanceKey]: value }))
                    }
                    nodeError={nodeError[instanceKey]}
                    nodeOutput={nodeOutput[instanceKey]}
                    onListPendingNodes={() =>
                      void runListPendingNodes(instance.openclawId, instance.openclawServerId, instance.ipv4)
                    }
                    onApproveNode={(requestId) =>
                      void runApproveNode(
                        instance.openclawId,
                        instance.openclawServerId,
                        instance.ipv4,
                        requestId
                      )
                    }
                  />
                ) : null}
                {instance.openclawServerId || instance.ipv4 ? (
                  <div style={{ marginTop: 12 }}>
                    {instance.openclawId ? (
                      <WhatsAppSection
                        number={whatsAppNumbers[instanceKey] ?? ""}
                        onNumberChange={(value) =>
                          setWhatsAppNumbers((prev) => ({ ...prev, [instanceKey]: value }))
                        }
                        configState={whatsAppConfig[instanceKey]}
                        pairing={whatsAppPairing[instanceKey]}
                        onPairStart={(force) =>
                          void runWhatsAppPairStart(
                            instance.openclawId,
                            instance.openclawServerId,
                            instance.ipv4,
                            force
                          )
                        }
                        onPairWait={() =>
                          void runWhatsAppPairWait(instance.openclawId, instance.openclawServerId, instance.ipv4)
                        }
                        onConfigSet={() =>
                          void runWhatsAppConfigSet(
                            instance.openclawId,
                            instance.openclawServerId,
                            instance.ipv4,
                            whatsAppNumbers[instanceKey] ?? ""
                          )
                        }
                      />
                    ) : null}
                    {instance.openclawId ? (
                      <div style={{ marginBottom: 12 }}>
                        <TelegramSection
                          botToken={telegramBotTokens[instanceKey] ?? ""}
                          onBotTokenChange={(value) =>
                            setTelegramBotTokens((prev) => ({ ...prev, [instanceKey]: value }))
                          }
                          configState={telegramConfig[instanceKey]}
                          onSave={() =>
                            void runTelegramConfigSet(
                              instance.openclawId,
                              instance.openclawServerId,
                              instance.ipv4,
                              telegramBotTokens[instanceKey] ?? ""
                            )
                          }
                        />
                        <AiConfigSection
                          provider={aiProviders[instanceKey] ?? ""}
                          apiKey={aiApiKeys[instanceKey] ?? ""}
                          model={aiModels[instanceKey] ?? ""}
                          onProviderChange={(prov) => {
                            setAiProviders((prev) => ({ ...prev, [instanceKey]: prov }));
                            setAiModels((prev) => ({
                              ...prev,
                              [instanceKey]: prov === "anthropic" ? "anthropic/claude-sonnet-4-5" : "openai/gpt-4o"
                            }));
                          }}
                          onApiKeyChange={(value) =>
                            setAiApiKeys((prev) => ({ ...prev, [instanceKey]: value }))
                          }
                          onModelChange={(value) =>
                            setAiModels((prev) => ({ ...prev, [instanceKey]: value }))
                          }
                          configState={aiConfig[instanceKey]}
                          onSave={() =>
                            void runAiConfigSet(instance.openclawId, instance.openclawServerId, instance.ipv4)
                          }
                        />
                      </div>
                    ) : null}
                    {instance.openclawId ? (
                      <OpenClawExecSection
                        command={openClawCommands[instanceKey] ?? ""}
                        onCommandChange={(value) =>
                          setOpenClawCommands((prev) => ({ ...prev, [instanceKey]: value }))
                        }
                        commandState={openClawCommandResults[instanceKey]}
                        onRun={() =>
                          void runOpenClawExec(
                            instance.openclawId,
                            instance.openclawServerId,
                            instance.ipv4,
                            openClawCommands[instanceKey] ?? ""
                          )
                        }
                      />
                    ) : null}
                    <InstanceAuthSection instance={instance} actions={providerAuthActions} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
