import {
  RUNTIME_WHATSAPP_CONFIG_SET_RESULT,
  RUNTIME_WHATSAPP_PAIR_START_RESULT,
  RUNTIME_WHATSAPP_PAIR_WAIT_RESULT,
} from "@opengroow/protocol";
import {
  isLikelyE164,
  readEnabled,
  readForce,
  readPhoneNumber,
  readTimeoutMs,
} from "./command-inputs.js";
import { createEventMessage } from "./event-message.js";
import type { CommandHandler } from "./types.js";

export const handleWhatsAppConfigSet: CommandHandler = async (command, deps) => {
  const phoneNumber = readPhoneNumber(command.payload);
  const enabled = readEnabled(command.payload);
  if (phoneNumber && !isLikelyE164(phoneNumber)) {
    return createEventMessage(RUNTIME_WHATSAPP_CONFIG_SET_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error:
        "WhatsApp number must be in E.164 format, for example +33612345678",
      data: {
        output: "",
        phoneNumber,
      },
    });
  }

  try {
    deps.log(
      enabled !== undefined
        ? `whatsapp config: setting enabled=${enabled}`
        : `whatsapp config: applying ${phoneNumber ? `self-chat for ${phoneNumber}` : "pairing mode"}`,
    );
    await deps.gatewayClient.applyWhatsAppConfig(phoneNumber, enabled);
    deps.log("whatsapp config: applied");
    return createEventMessage(RUNTIME_WHATSAPP_CONFIG_SET_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: true,
      data: {
        output:
          enabled !== undefined
            ? `WhatsApp channel ${enabled ? "enabled" : "disabled"}.`
            : phoneNumber
              ? `WhatsApp number saved for ${phoneNumber}.`
              : "WhatsApp DM policy reset to pairing mode.",
        phoneNumber,
        enabled,
      },
    });
  } catch (error) {
    return createEventMessage(RUNTIME_WHATSAPP_CONFIG_SET_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error:
        error instanceof Error ? error.message : "WhatsApp config update failed",
      data: {
        output: "",
        phoneNumber,
      },
    });
  }
};

export const handleWhatsAppPairStart: CommandHandler = async (command, deps) => {
  const timeoutMs = readTimeoutMs(command.payload, 15_000);
  const force = readForce(command.payload);
  try {
    const result = await deps.gatewayClient.requestGatewayControl<{
      output: string;
      linked?: boolean;
      connected: boolean;
      qrDataUrl?: string;
      qrExpiresInMs?: number;
    }>("/whatsapp/pair/start", {
      force,
      timeoutMs,
    });
    return createEventMessage(RUNTIME_WHATSAPP_PAIR_START_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: true,
      data: {
        output: result.output,
        linked: result.linked,
        connected: result.connected,
        qrDataUrl: result.qrDataUrl,
        qrExpiresInMs: result.qrExpiresInMs,
      },
    });
  } catch (error) {
    return createEventMessage(RUNTIME_WHATSAPP_PAIR_START_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error:
        error instanceof Error ? error.message : "WhatsApp pairing failed",
      data: {
        output: "",
        linked: false,
        connected: false,
      },
    });
  }
};

export const handleWhatsAppPairWait: CommandHandler = async (command, deps) => {
  const timeoutMs = readTimeoutMs(command.payload, 5_000);
  try {
    const result = await deps.gatewayClient.requestGatewayControl<{
      output: string;
      linked?: boolean;
      connected: boolean;
      qrDataUrl?: string;
      qrExpiresInMs?: number;
    }>("/whatsapp/pair/wait", {
      timeoutMs,
    });
    return createEventMessage(RUNTIME_WHATSAPP_PAIR_WAIT_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: true,
      data: {
        output: result.output || "WhatsApp status checked.",
        linked: result.linked,
        connected: result.connected,
        // The QR rotates while the user scans: each check carries the current one.
        qrDataUrl: result.qrDataUrl,
        qrExpiresInMs: result.qrExpiresInMs,
      },
    });
  } catch (error) {
    return createEventMessage(RUNTIME_WHATSAPP_PAIR_WAIT_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "WhatsApp pairing status failed",
      data: {
        output: "",
        linked: false,
        connected: false,
      },
    });
  }
};
