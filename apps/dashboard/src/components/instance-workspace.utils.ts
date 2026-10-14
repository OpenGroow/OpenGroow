import type {
  AiConfigState,
  ParsedWorkspaceFilePayload,
  ParsedWorkspaceListPayload,
  ParsedWorkspaceSkillFilesPayload,
  WhatsAppPairingState,
} from "./instance-workspace.types";
import {
  RUNTIME_WORKSPACE_FILE_READ_RESULT,
  RUNTIME_WORKSPACE_LIST_RESULT,
  RUNTIME_WORKSPACE_SKILL_FILES_RESULT,
  type RuntimeWorkspaceDescriptor,
  type RuntimeWorkspaceFileEntry,
} from "@opengroow/protocol/runtime-workspace";

function parseWorkspaceFileEntry(file: unknown): RuntimeWorkspaceFileEntry | null {
  if (!file || typeof file !== "object") {
    return null;
  }
  const fileRecord = file as Record<string, unknown>;
  const filePath = typeof fileRecord.filePath === "string" ? fileRecord.filePath : "";
  const title = typeof fileRecord.title === "string" ? fileRecord.title : "";
  const kind = fileRecord.kind;
  if (!filePath || !title || (kind !== "standard" && kind !== "memory" && kind !== "skill")) {
    return null;
  }
  return { filePath, title, kind };
}

export function parseWorkspaceListPayload(
  type: string | undefined,
  payload: unknown,
): ParsedWorkspaceListPayload | null {
  if (type !== RUNTIME_WORKSPACE_LIST_RESULT) {
    return null;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const payloadRecord = payload as Record<string, unknown>;
  const data =
    payloadRecord.data && typeof payloadRecord.data === "object"
      ? (payloadRecord.data as Record<string, unknown>)
      : {};
  const workspaces = Array.isArray(data.workspaces)
    ? data.workspaces
        .map((workspace): RuntimeWorkspaceDescriptor | null => {
          if (!workspace || typeof workspace !== "object") {
            return null;
          }
          const workspaceRecord = workspace as Record<string, unknown>;
          const availableFiles = Array.isArray(workspaceRecord.availableFiles)
            ? workspaceRecord.availableFiles
                .map(parseWorkspaceFileEntry)
                .filter((file): file is RuntimeWorkspaceFileEntry => file !== null)
            : [];
          const workspaceKey =
            typeof workspaceRecord.workspaceKey === "string"
              ? workspaceRecord.workspaceKey
              : "";
          const label =
            typeof workspaceRecord.label === "string"
              ? workspaceRecord.label
              : "";
          const absolutePath =
            typeof workspaceRecord.absolutePath === "string"
              ? workspaceRecord.absolutePath
              : "";
          const kind = workspaceRecord.kind;

          if (
            !workspaceKey ||
            !label ||
            !absolutePath ||
            (kind !== "default" &&
              kind !== "profile" &&
              kind !== "legacy" &&
              kind !== "custom" &&
              kind !== "managed")
          ) {
            return null;
          }

          return {
            workspaceKey,
            label,
            absolutePath,
            isActive: workspaceRecord.isActive === true,
            kind,
            availableFiles,
          };
        })
        .filter((workspace): workspace is RuntimeWorkspaceDescriptor => workspace !== null)
    : [];

  return {
    ok: payloadRecord.ok !== false,
    error:
      typeof payloadRecord.error === "string" ? payloadRecord.error : undefined,
    workspaces,
  };
}

export function parseWorkspaceFilePayload(
  type: string | undefined,
  payload: unknown,
): ParsedWorkspaceFilePayload | null {
  if (type !== RUNTIME_WORKSPACE_FILE_READ_RESULT) {
    return null;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const payloadRecord = payload as Record<string, unknown>;
  const data =
    payloadRecord.data && typeof payloadRecord.data === "object"
      ? (payloadRecord.data as Record<string, unknown>)
      : {};

  return {
    ok: payloadRecord.ok !== false,
    error:
      typeof payloadRecord.error === "string" ? payloadRecord.error : undefined,
    workspaceKey:
      typeof data.workspaceKey === "string" ? data.workspaceKey : "",
    filePath: typeof data.filePath === "string" ? data.filePath : "",
    title: typeof data.title === "string" ? data.title : "",
    content: typeof data.content === "string" ? data.content : "",
    lastModifiedAt:
      typeof data.lastModifiedAt === "string" ? data.lastModifiedAt : undefined,
  };
}

export function parseWorkspaceSkillFilesPayload(
  type: string | undefined,
  payload: unknown,
): ParsedWorkspaceSkillFilesPayload | null {
  if (type !== RUNTIME_WORKSPACE_SKILL_FILES_RESULT) {
    return null;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const payloadRecord = payload as Record<string, unknown>;
  const data =
    payloadRecord.data && typeof payloadRecord.data === "object"
      ? (payloadRecord.data as Record<string, unknown>)
      : {};

  const files = Array.isArray(data.files)
    ? data.files
        .map(parseWorkspaceFileEntry)
        .filter((file): file is RuntimeWorkspaceFileEntry => file !== null)
    : [];

  return {
    ok: payloadRecord.ok !== false,
    error:
      typeof payloadRecord.error === "string" ? payloadRecord.error : undefined,
    workspaceKey:
      typeof data.workspaceKey === "string" ? data.workspaceKey : "",
    spec: typeof data.spec === "string" ? data.spec : "",
    files,
  };
}

export function isWhatsAppQrExpiredMessage(output: string | undefined): boolean {
  const normalized = output?.toLowerCase() ?? "";
  return (
    normalized.includes("status=408") ||
    normalized.includes("request time-out qr refs attempts ended") ||
    normalized.includes("login qr expired") ||
    normalized.includes("generate a new qr")
  );
}

export function extractUrls(output: string): string[] {
  if (!output) {
    return [];
  }
  const matches = output.match(/https?:\/\/[^\s]+/g) ?? [];
  return Array.from(new Set(matches));
}

export function extractAuthBrowserUrl(logs: string[]): string | undefined {
  if (!logs.length) {
    return undefined;
  }

  for (let index = 0; index < logs.length; index += 1) {
    const line = logs[index] ?? "";
    if (!/Open this URL in your LOCAL browser:/i.test(line)) {
      continue;
    }

    const inlineUrl = extractUrls(line)[0];
    if (inlineUrl) {
      return inlineUrl;
    }

    const nextLineUrl = extractUrls(logs[index + 1] ?? "")[0];
    if (nextLineUrl) {
      return nextLineUrl;
    }
  }

  return extractUrls(logs.join("\n"))[0];
}

export function isMissingAuthSessionError(message: string | undefined): boolean {
  return /auth session not found/i.test(message ?? "");
}

export function isRestartRecoveredAuthError(message: string | undefined): boolean {
  return /gateway restarted during authorization/i.test(message ?? "");
}

export function labelForProvider(provider: string): string {
  if (provider === "anthropic") return "Anthropic";
  if (provider === "xiaomi") return "Xiaomi";
  if (provider === "openrouter") return "OpenRouter";
  return "OpenAI";
}

export function defaultBaseUrlForProvider(provider: string): string {
  if (provider === "xiaomi") return "https://token-plan-ams.xiaomimimo.com/v1";
  if (provider === "openrouter") return "https://openrouter.ai/api/v1";
  return "";
}

export function defaultApiKeyForProvider(_provider: string): string {
  return "";
}

// OpenClaw always resolves models as "<provider>/<model>" — prefix the
// provider automatically so users can paste a bare model id (or one already
// copied with its provider prefix, e.g. from openrouter.ai) without hitting
// "Unknown model". Idempotent: a model already qualified for this provider
// is left untouched, so re-saving a form never double-prefixes it.
export function qualifyModelForProvider(provider: string, model: string): string {
  const trimmed = model.trim();
  if (trimmed && !trimmed.startsWith(`${provider}/`)) {
    return `${provider}/${trimmed}`;
  }
  return trimmed;
}

export function isAiConfigured(aiConfig: AiConfigState): boolean {
  return aiConfig.status === "saved";
}

export function getWorkspaceStatusLabel(
  status: string,
  runtimeStatus: string | undefined,
  runtimeReady: boolean | undefined,
): string {
  const normalized = status.toLowerCase();
  const normalizedRuntimeStatus = runtimeStatus?.toLowerCase();

  if (normalized === "failed" || normalizedRuntimeStatus === "failed") {
    return "Issue";
  }
  if (normalizedRuntimeStatus === "linked") {
    return "Linked";
  }
  if (normalizedRuntimeStatus === "created") {
    return "Created";
  }
  if (
    normalizedRuntimeStatus === "provisioning" ||
    normalizedRuntimeStatus === "starting" ||
    normalized === "queued" ||
    normalized === "running"
  ) {
    return "Starting";
  }
  return "Provisioning";
}

export function getWhatsAppConnectionState(
  whatsAppPairing: WhatsAppPairingState,
): "connected" | "linked" | "pending" {
  if (whatsAppPairing.connected === true) {
    return "connected";
  }
  if (whatsAppPairing.linked === true) {
    return "linked";
  }
  return "pending";
}

export function findInstanceById<T extends { openclawId?: string; jobId: string }>(
  instances: T[] | undefined,
  id: string,
): T | undefined {
  return instances?.find((entry) => entry.openclawId === id || entry.jobId === id);
}
