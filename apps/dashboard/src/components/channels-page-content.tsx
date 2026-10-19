"use client";

import { useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { AudioLines, MessageCircle, Save, Send } from "lucide-react";
import { api } from "@convex/_generated/api";

const WHATSAPP_PAIR_START_TIMEOUT_MS = 30_000;
// Each check answers with the current QR, which WhatsApp rotates while the
// user scans: keep the checks short so the one on screen stays fresh.
const WHATSAPP_PAIR_WAIT_TIMEOUT_MS = 3_000;

import type {
  InstanceRecord,
  SpeechToTextConfigState,
  TelegramConfigState,
  WhatsAppConfigState,
  WhatsAppPairingState,
} from "@/src/components/instance-workspace.types";
import {
  getWhatsAppConnectionState,
  isWhatsAppQrExpiredMessage,
} from "@/src/components/instance-workspace.utils";
import { GroqSpeechConfigCard } from "@/src/components/instance-workspace/groq-speech-config-card";
import { WorkspaceConfigCard } from "@/src/components/instance-workspace/workspace-config-card";
import { WorkspaceStatusBadge } from "@/src/components/instance-workspace/workspace-status-badge";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";
import { useOptionalPlugin } from "@/src/components/optional-plugins-provider";
import { PluginUnavailableCard } from "@/src/components/plugin-unavailable-card";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = { resolvedInstanceId: string };

export function ChannelsPageContent({ resolvedInstanceId }: Props) {
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramConfig, setTelegramConfig] = useState<TelegramConfigState>({});
  const [speechToTextApiKey, setSpeechToTextApiKey] = useState("");
  const [speechToTextEnabled, setSpeechToTextEnabled] = useState(false);
  const [speechToTextConfig, setSpeechToTextConfig] =
    useState<SpeechToTextConfigState>({});
  const whatsAppAvailable = useOptionalPlugin("whatsapp");
  const groqAvailable = useOptionalPlugin("groq");
  const [whatsAppNumber, setWhatsAppNumber] = useState("");
  const [whatsAppConfig, setWhatsAppConfig] = useState<WhatsAppConfigState>({});
  const [whatsAppPairing, setWhatsAppPairing] = useState<WhatsAppPairingState>({});
  const [whatsAppPairFlowOpen, setWhatsAppPairFlowOpen] = useState(false);
  // A ref, not state: the delayed checks run in closures made before the
  // deadline was set and would read a stale value (an instant "QR expired").
  const whatsAppCheckUntilRef = useRef(0);
  const [whatsAppQrStale, setWhatsAppQrStale] = useState(false);
  const [whatsAppEnabledStatus, setWhatsAppEnabledStatus] = useState<
    "idle" | "saving" | "error"
  >("idle");
  const [whatsAppEnabledError, setWhatsAppEnabledError] = useState<string>();

  const instances = useAuthenticatedInstances<InstanceRecord>();
  const configureTelegram = useAction(api.project_channel_operations.configureTelegram);
  const configureSpeechToText = useAction(
    api.project_channel_operations.configureSpeechToText,
  );
  const startWhatsAppPairing = useAction(
    api.project_channel_operations.startWhatsAppPairing,
  );
  const waitWhatsAppPairing = useAction(
    api.project_channel_operations.waitWhatsAppPairing,
  );
  const configureWhatsApp = useAction(api.project_channel_operations.configureWhatsApp);

  const instance = instances?.find(
    (entry) =>
      entry.openclawId === resolvedInstanceId || entry.jobId === resolvedInstanceId,
  );

  // The QR is only good until the Instance says so: dim it then, and the next
  // check (every few seconds) brings the fresh one.
  const qrExpiresAtMs = whatsAppPairing.qrExpiresAtMs;
  useEffect(() => {
    if (qrExpiresAtMs === undefined) {
      setWhatsAppQrStale(false);
      return;
    }
    const remainingMs = qrExpiresAtMs - Date.now();
    setWhatsAppQrStale(remainingMs <= 0);
    if (remainingMs <= 0) return;
    const timer = window.setTimeout(() => setWhatsAppQrStale(true), remainingMs);
    return () => window.clearTimeout(timer);
  }, [qrExpiresAtMs]);

  useEffect(() => {
    const persistedPhoneNumber = instance?.whatsAppChannel?.phoneNumber?.trim();
    if (!persistedPhoneNumber) {
      return;
    }

    setWhatsAppNumber((currentValue) =>
      currentValue.trim().length > 0 ? currentValue : persistedPhoneNumber,
    );
    setWhatsAppConfig((prev) => ({
      ...prev,
      phoneNumber: prev.phoneNumber ?? persistedPhoneNumber,
    }));
  }, [instance?.whatsAppChannel?.phoneNumber]);

  useEffect(() => {
    if (
      instance?.speechToText &&
      speechToTextConfig.status !== "saving"
    ) {
      setSpeechToTextEnabled(instance.speechToText.enabled);
    }
  }, [
    instance?.speechToText,
    instance?.speechToText?.enabled,
    speechToTextConfig.status,
  ]);

  const persistedWhatsAppChannel = instance?.whatsAppChannel;
  const whatsAppEnabled = persistedWhatsAppChannel?.enabled !== false;
  const persistedTelegramChannel = instance?.telegramChannel;
  const persistedSpeechToText = instance?.speechToText;
  const effectiveTelegramConfigured =
    telegramConfig.status === "saved" ||
    persistedTelegramChannel?.configured === true;
  const speechToTextConfigured =
    persistedSpeechToText?.provider === "groq" ||
    speechToTextConfig.status === "saved";
  const canSaveSpeechToText =
    instance?.openclawId !== undefined &&
    speechToTextConfig.status !== "saving" &&
    (speechToTextApiKey.trim().length > 0 || speechToTextConfigured);
  const effectiveWhatsAppConnected = whatsAppPairFlowOpen
    ? whatsAppPairing.connected === true
    : whatsAppPairing.connected === true || persistedWhatsAppChannel?.connected === true;
  const effectiveWhatsAppLinked = whatsAppPairFlowOpen
    ? effectiveWhatsAppConnected || whatsAppPairing.linked === true
    : effectiveWhatsAppConnected ||
      whatsAppPairing.linked === true ||
      persistedWhatsAppChannel?.linked === true;
  const whatsAppConnectionState = getWhatsAppConnectionState({
    ...whatsAppPairing,
    linked: effectiveWhatsAppLinked,
    connected: effectiveWhatsAppConnected,
  });
  const savedWhatsAppNumber = (
    whatsAppConfig.phoneNumber ??
    persistedWhatsAppChannel?.phoneNumber ??
    ""
  ).trim();
  const currentWhatsAppNumber = whatsAppNumber.trim();
  const whatsAppStepOneComplete =
    currentWhatsAppNumber.length > 0 && currentWhatsAppNumber === savedWhatsAppNumber;
  const whatsAppPairingPending =
    whatsAppPairing.status === "starting" ||
    whatsAppPairing.status === "checking" ||
    whatsAppPairing.status === "restarting";

  async function handleSaveTelegram(): Promise<void> {
    if (!instance?.openclawId) {
      setTelegramConfig({ status: "error", error: "Project not connected yet" });
      return;
    }
    if (!telegramBotToken.trim()) {
      setTelegramConfig({
        status: "error",
        error: "Bot token is required",
      });
      return;
    }

    setTelegramConfig({ status: "saving" });
    try {
      const result = await configureTelegram({
        instanceId: instance.openclawId,
        botToken: telegramBotToken.trim(),
        dmPolicy: "open",
      });
      setTelegramConfig({
        status: result.ok ? "saved" : "error",
        output: result.output || "Telegram bot token saved.",
        error: result.ok ? undefined : result.error,
      });
    } catch (error: unknown) {
      setTelegramConfig({
        status: "error",
        error:
          error instanceof Error ? error.message : "Failed to save Telegram token",
      });
    }
  }

  async function handleSaveWhatsAppNumber(): Promise<void> {
    if (!instance?.openclawId) {
      setWhatsAppConfig({ status: "failed", error: "Project not connected yet" });
      return;
    }

    const trimmedNumber = whatsAppNumber.trim();
    if (trimmedNumber && !/^\+[1-9]\d{5,19}$/.test(trimmedNumber)) {
      setWhatsAppConfig({
        status: "failed",
        error: "Use E.164 format, for example +33612345678",
      });
      return;
    }

    setWhatsAppConfig({ status: "saving" });
    try {
      const data = await configureWhatsApp({
        instanceId: instance.openclawId,
        phoneNumber: trimmedNumber,
      });
      setWhatsAppConfig({
        status: data.ok ? "saved" : "failed",
        output: data.output,
        error: data.ok ? undefined : data.error,
        phoneNumber: data.phoneNumber,
      });
      if (data.phoneNumber) setWhatsAppNumber(data.phoneNumber);
    } catch (error: unknown) {
      setWhatsAppConfig({
        status: "failed",
        error:
          error instanceof Error ? error.message : "Failed to save WhatsApp config",
      });
    }
  }

  async function handleToggleWhatsAppEnabled(nextEnabled: boolean): Promise<void> {
    if (!instance?.openclawId) {
      setWhatsAppEnabledStatus("error");
      setWhatsAppEnabledError("Project not connected yet");
      return;
    }

    setWhatsAppEnabledStatus("saving");
    setWhatsAppEnabledError(undefined);
    try {
      await configureWhatsApp({
        instanceId: instance.openclawId,
        phoneNumber: "",
        enabled: nextEnabled,
      });
      setWhatsAppEnabledStatus("idle");
    } catch (error: unknown) {
      setWhatsAppEnabledStatus("error");
      setWhatsAppEnabledError(
        error instanceof Error ? error.message : "Failed to update WhatsApp channel",
      );
    }
  }

  async function handleSaveSpeechToText(): Promise<void> {
    if (!instance?.openclawId) {
      setSpeechToTextConfig({ status: "error", error: "Project not connected yet" });
      return;
    }

    setSpeechToTextConfig((prev) => ({
      ...prev,
      status: "saving",
      error: undefined,
      output: undefined,
    }));
    try {
      const data = await configureSpeechToText({
        instanceId: instance.openclawId,
        provider: "groq",
        enabled: speechToTextEnabled,
        apiKey: speechToTextApiKey.trim() || undefined,
      });
      setSpeechToTextEnabled(data.enabled);
      setSpeechToTextApiKey("");
      setSpeechToTextConfig({
        status: data.ok ? "saved" : "error",
        output: data.output,
        error: data.ok ? undefined : data.error,
      });
    } catch (error: unknown) {
      setSpeechToTextConfig((prev) => ({
        ...prev,
        status: "error",
        error:
          error instanceof Error
            ? error.message
            : "Failed to save speech-to-text config",
      }));
    }
  }

  async function saveWhatsAppNumberIfNeeded(): Promise<boolean> {
    const trimmedNumber = whatsAppNumber.trim();
    const appliedPhoneNumber = (whatsAppConfig.phoneNumber ?? "").trim();

    if (!trimmedNumber) {
      setWhatsAppConfig({
        status: "failed",
        error: "Enter a WhatsApp number before pairing.",
      });
      return false;
    }

    if (!/^\+[1-9]\d{5,19}$/.test(trimmedNumber)) {
      setWhatsAppConfig({
        status: "failed",
        error: "Use E.164 format, for example +33612345678",
      });
      return false;
    }

    if (trimmedNumber !== appliedPhoneNumber) {
      setWhatsAppConfig({
        status: "failed",
        error: "Save the WhatsApp number before pairing.",
      });
      return false;
    }

    return true;
  }

  async function handleStartWhatsApp(force = false): Promise<void> {
    setWhatsAppPairFlowOpen(true);
    if (!instance?.openclawId) {
      setWhatsAppPairing({
        status: "failed",
        error: "OpenClaw id missing for this Project",
      });
      return;
    }

    try {
      const numberSaved = await saveWhatsAppNumberIfNeeded();
      if (!numberSaved) {
        setWhatsAppPairing((prev) => ({
          ...prev,
          status: "failed",
          error: "Save a valid WhatsApp number before pairing.",
        }));
        return;
      }

      setWhatsAppPairing({
        status: force ? "restarting" : "starting",
        output: "",
        qrDataUrl: undefined,
        linked: false,
        connected: false,
        error: undefined,
      });
      const data = await startWhatsAppPairing({
        instanceId: instance.openclawId,
        force,
        timeoutMs: WHATSAPP_PAIR_START_TIMEOUT_MS,
      });
      // The check window must exist before the result is applied: otherwise a
      // fresh QR is judged against the previous (empty) window and reported as
      // expired.
      whatsAppCheckUntilRef.current = Date.now() + 3 * 60_000;
      applyWhatsAppResult(data, "start");
    } catch (error: unknown) {
      setWhatsAppPairing({
        status: "failed",
        error:
          error instanceof Error
            ? error.message
            : "Failed to start WhatsApp pairing",
      });
    }
  }

  async function handleReconnectWhatsApp(): Promise<void> {
    setWhatsAppPairFlowOpen(true);
    if (!instance?.openclawId) {
      setWhatsAppPairing({ status: "failed", error: "OpenClaw id missing for this Project" });
      return;
    }
    try {
      setWhatsAppPairing({
        status: "restarting",
        output: "",
        qrDataUrl: undefined,
        linked: false,
        connected: false,
        error: undefined,
      });
      const data = await startWhatsAppPairing({
        instanceId: instance.openclawId,
        force: false,
        timeoutMs: WHATSAPP_PAIR_START_TIMEOUT_MS,
      });
      // The check window must exist before the result is applied: otherwise a
      // fresh QR is judged against the previous (empty) window and reported as
      // expired.
      whatsAppCheckUntilRef.current = Date.now() + 3 * 60_000;
      applyWhatsAppResult(data, "start");
    } catch (error: unknown) {
      setWhatsAppPairing({
        status: "failed",
        error: error instanceof Error ? error.message : "Failed to reconnect WhatsApp",
      });
    }
  }

  async function handleCheckWhatsApp(): Promise<void> {
    if (!instance?.openclawId) {
      setWhatsAppPairing({
        status: "failed",
        error: "OpenClaw id missing for this Project",
      });
      return;
    }

    try {
      setWhatsAppPairing((prev) => ({
        ...prev,
        status: "checking",
        error: undefined,
      }));
      const data = await waitWhatsAppPairing({
        instanceId: instance.openclawId,
        timeoutMs: WHATSAPP_PAIR_WAIT_TIMEOUT_MS,
      });
      applyWhatsAppResult(data, "wait");
    } catch (error: unknown) {
      setWhatsAppPairing((prev) => ({
        ...prev,
        status: "failed",
        error:
          error instanceof Error ? error.message : "Failed to check WhatsApp link",
      }));
    }
  }

  function applyWhatsAppResult(
    parsed: {
      ok: boolean;
      output: string;
      linked: boolean;
      connected: boolean;
      qrDataUrl?: string;
      qrExpiresInMs?: number;
      error?: string;
    },
    phase: "start" | "wait",
  ): void {

    const clearQr =
      parsed.connected ||
      parsed.linked ||
      !parsed.ok ||
      isWhatsAppQrExpiredMessage(parsed.output) ||
      isWhatsAppQrExpiredMessage(parsed.error);

    setWhatsAppPairing((prev) => ({
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
      qrDataUrl: clearQr ? undefined : (parsed.qrDataUrl ?? prev.qrDataUrl),
      qrExpiresAtMs: clearQr
        ? undefined
        : parsed.qrDataUrl
          ? parsed.qrExpiresInMs === undefined
            ? undefined
            : Date.now() + parsed.qrExpiresInMs
          : prev.qrExpiresAtMs,
      linked: parsed.linked,
      connected: parsed.connected,
      error: parsed.ok ? undefined : parsed.error,
    }));

    // A failure keeps its own message: it is not an expired QR.
    if (!parsed.ok) {
      whatsAppCheckUntilRef.current = 0;
      return;
    }

    if (parsed.connected || parsed.linked) {
      whatsAppCheckUntilRef.current = 0;
      const desiredPhoneNumber = whatsAppNumber.trim();
      const appliedPhoneNumber = (whatsAppConfig.phoneNumber ?? "").trim();
      if (desiredPhoneNumber && desiredPhoneNumber !== appliedPhoneNumber) {
        void handleSaveWhatsAppNumber();
      }
      return;
    }

    if (instance?.openclawId && whatsAppCheckUntilRef.current > Date.now()) {
      window.setTimeout(() => {
        void handleCheckWhatsApp();
      }, parsed.qrDataUrl ? 1500 : 2500);
      return;
    }

    if (whatsAppCheckUntilRef.current <= Date.now()) {
      setWhatsAppPairing((prev) => ({
        ...prev,
        status: "failed",
        qrDataUrl: undefined,
        error: "WhatsApp QR expired. Generate a new QR and scan immediately.",
      }));
      whatsAppCheckUntilRef.current = 0;
    }
  }

  if (!instance) {
    return null;
  }

  return (
    <section className="grid max-w-4xl gap-5">
      {whatsAppAvailable ? (
        <WorkspaceConfigCard
          icon={MessageCircle}
          tone="cyan"
          title="WhatsApp"
          description="Configure the WhatsApp number first, then generate and scan the QR code."
          badge={
            <WorkspaceStatusBadge
              label={
                whatsAppConnectionState === "connected"
                  ? "Linked"
                  : whatsAppConnectionState === "linked"
                    ? "Linked"
                    : "Pending"
              }
              tone={
                whatsAppConnectionState === "connected" ||
                whatsAppConnectionState === "linked"
                  ? "success"
                  : "muted"
              }
            />
          }
        >
          <CardContent className="grid gap-5 px-6">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/50 px-4 py-3">
              <div className="grid gap-1">
                <p className="text-sm font-medium text-foreground">
                  {whatsAppEnabled ? "WhatsApp channel is active" : "WhatsApp channel is disabled"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Turn it off if it keeps retrying to connect without linking.
                </p>
              </div>
              <Button size="lg"
                type="button"
                variant="outline"
                disabled={whatsAppEnabledStatus === "saving"}
                onClick={() => void handleToggleWhatsAppEnabled(!whatsAppEnabled)}
              >
                {whatsAppEnabledStatus === "saving"
                  ? "Saving…"
                  : whatsAppEnabled
                    ? "Disable"
                    : "Enable"}
              </Button>
            </div>
            {whatsAppEnabledError ? (
              <p className="text-sm text-destructive">{whatsAppEnabledError}</p>
            ) : null}
            {!whatsAppEnabled && persistedWhatsAppChannel?.autoDisabledReason ? (
              <p className="text-sm text-destructive">
                {persistedWhatsAppChannel.autoDisabledReason}
              </p>
            ) : null}

            {whatsAppConnectionState === "connected" ? (
              <Button size="lg"
                type="button"
                className="w-fit"
                onClick={() => void handleStartWhatsApp(true)}
              >
                Relink WhatsApp
              </Button>
            ) : whatsAppConnectionState === "linked" && !whatsAppPairFlowOpen ? (
              <div className="grid gap-3">
                <Button size="lg"
                  type="button"
                  className="w-fit"
                  onClick={() => void handleReconnectWhatsApp()}
                  disabled={whatsAppPairingPending}
                >
                  {whatsAppPairingPending ? "Reconnecting…" : "Reconnect WhatsApp"}
                </Button>
                <Button
                  variant="link"
                  type="button"
                  className="h-auto p-0 w-fit"
                  onClick={() => setWhatsAppPairFlowOpen(true)}
                >
                  Scan a new QR code instead
                </Button>
              </div>
            ) : !whatsAppPairFlowOpen ? (
              <Button size="lg"
                type="button"
                className="w-fit"
                onClick={() => setWhatsAppPairFlowOpen(true)}
              >
                Pair WhatsApp
              </Button>
            ) : (
              <div className="grid gap-4">
                <div
                  className={`grid gap-3 rounded-xl border p-5 ${
                    whatsAppStepOneComplete
                      ? "border-border bg-muted/50 opacity-60"
                      : "border-border bg-muted"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                      1
                    </div>
                    <div className="grid gap-2">
                      <h4 className="text-base font-semibold text-foreground">
                        Save the WhatsApp number
                      </h4>
                      <p className="text-sm leading-6 text-muted-foreground">
                        Enter the E.164 number that should be allowed for routing
                        before starting the pairing flow.
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="whatsapp-number">WhatsApp Number</Label>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                      <Input
                        id="whatsapp-number"
                        value={whatsAppNumber}
                        onChange={(event) => setWhatsAppNumber(event.target.value)}
                        disabled={whatsAppStepOneComplete}
                        placeholder="+33612345678"
                        className="h-11 lg:w-[20rem]"
                      />
                      <Button variant="secondary" size="lg"
                        type="button"
                        disabled={
                          whatsAppConfig.status === "saving" || whatsAppStepOneComplete
                        }
                        className="w-fit"
                        onClick={() => void handleSaveWhatsAppNumber()}
                      >
                        {whatsAppConfig.status === "saving"
                          ? "Saving number…"
                          : "Save WhatsApp Number"}
                      </Button>
                    </div>
                  </div>
                  {whatsAppConfig.output ? (
                    <p className="text-sm text-status-success">{whatsAppConfig.output}</p>
                  ) : null}
                  {whatsAppConfig.error ? (
                    <p className="text-sm text-destructive">{whatsAppConfig.error}</p>
                  ) : null}
                </div>

                <div
                  className={`grid gap-3 rounded-xl border p-5 ${
                    whatsAppStepOneComplete
                      ? "border-border bg-muted"
                      : "border-border bg-muted/50 opacity-60"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                      2
                    </div>
                    <div className="grid gap-2">
                      <h4 className="text-base font-semibold text-foreground">
                        Pair the WhatsApp session
                      </h4>
                      <p className="text-sm leading-6 text-muted-foreground">
                        Once the number is saved, generate a QR code, scan it from
                        WhatsApp Linked Devices, then confirm the session status here.
                      </p>
                    </div>
                  </div>
                  {!whatsAppStepOneComplete ? (
                    <p className="text-sm text-muted-foreground">
                      Save the WhatsApp number in step 1 to unlock pairing.
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-3">
                    <Button size="lg"
                      type="button"
                      disabled={!whatsAppStepOneComplete || whatsAppPairingPending}
                      onClick={() => void handleStartWhatsApp(false)}
                    >
                      {whatsAppPairingPending ? "Waiting…" : "Generate QR Code"}
                    </Button>
                  </div>
                  {whatsAppPairing.status ? (
                    <p className="text-sm text-muted-foreground">
                      WhatsApp status: {whatsAppPairing.status}
                    </p>
                  ) : null}
                  {whatsAppConnectionState === "linked" ? (
                    <p className="text-sm text-status-success">
                      WhatsApp is linked, but the session is currently disconnected.
                    </p>
                  ) : null}
                  {whatsAppPairing.error ? (
                    <p className="text-sm text-destructive">{whatsAppPairing.error}</p>
                  ) : null}
                  {whatsAppPairing.qrDataUrl ? (
                    <div className="flex flex-col items-start gap-2">
                      <img
                        src={whatsAppPairing.qrDataUrl}
                        alt="WhatsApp QR"
                        className={`h-[220px] w-[220px] rounded-xl bg-card p-3 ring-1 ring-inset ring-border ${whatsAppQrStale ? "opacity-30" : ""}`}
                      />
                      {whatsAppQrStale ? (
                        <p className="text-sm text-muted-foreground">Refreshing the QR code…</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </CardContent>
        </WorkspaceConfigCard>
      ) : (
        <PluginUnavailableCard
          icon={MessageCircle}
          tone="cyan"
          title="WhatsApp"
          pluginId="whatsapp"
        />
      )}

      {groqAvailable ? (
        <GroqSpeechConfigCard
          apiKey={speechToTextApiKey}
          enabled={speechToTextEnabled}
          config={speechToTextConfig}
          configured={speechToTextConfigured}
          canSave={canSaveSpeechToText}
          onApiKeyChange={setSpeechToTextApiKey}
          onEnabledChange={setSpeechToTextEnabled}
          onSave={() => void handleSaveSpeechToText()}
        />
      ) : (
        <PluginUnavailableCard
          icon={AudioLines}
          tone="violet"
          title="Groq Speech-to-Text"
          pluginId="groq"
        />
      )}

      <WorkspaceConfigCard
        icon={Send}
        tone="blue"
        title="Telegram"
        description="Save the token generated by @BotFather to enable direct messages on this Project."
        badge={
          telegramConfig.status === "saving" ? (
            <WorkspaceStatusBadge label="Saving" tone="muted" />
          ) : effectiveTelegramConfigured ? (
            <WorkspaceStatusBadge label="Connected" tone="success" />
          ) : (
            <WorkspaceStatusBadge label="Not connected" tone="muted" />
          )
        }
      >
        <CardContent className="grid gap-5 px-6">
          <div className="grid gap-3">
            <Label htmlFor="telegram-bot-token">Telegram Bot Token</Label>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <Input
                id="telegram-bot-token"
                type="password"
                value={telegramBotToken}
                onChange={(event) => setTelegramBotToken(event.target.value)}
                placeholder="1234567890:AAB..."
                className="h-11 lg:flex-1"
              />
              <Button size="lg"
                type="button"
                disabled={telegramConfig.status === "saving"}
                onClick={() => void handleSaveTelegram()}
              >
                {telegramConfig.status === "saving" ? null : <Save />}
                {telegramConfig.status === "saving"
                  ? "Saving…"
                  : "Save token"}
              </Button>
            </div>
          </div>
          {telegramConfig.output ? (
            <p className="text-sm text-status-success">{telegramConfig.output}</p>
          ) : null}
          {telegramConfig.error ? (
            <p className="text-sm text-destructive">{telegramConfig.error}</p>
          ) : null}
        </CardContent>
      </WorkspaceConfigCard>
    </section>
  );
}
