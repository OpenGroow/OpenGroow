export function readRequestId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const value = (payload as Record<string, unknown>).requestId;
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function readTimeoutMs(payload: unknown, fallbackMs: number): number {
  if (!payload || typeof payload !== "object") {
    return fallbackMs;
  }
  const value = (payload as Record<string, unknown>).timeoutMs;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallbackMs;
  }
  return Math.max(1000, Math.floor(value));
}

export function readForce(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  return (payload as Record<string, unknown>).force === true;
}

export function readPhoneNumber(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const value = (payload as Record<string, unknown>).phoneNumber;
  return typeof value === "string" ? value.trim() : "";
}

export function readEnabled(payload: unknown): boolean | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const value = (payload as Record<string, unknown>).enabled;
  return typeof value === "boolean" ? value : undefined;
}

export function readCommandText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const value = (payload as Record<string, unknown>).commandText;
  return typeof value === "string" ? value.trim() : "";
}

export function readWorkspaceKey(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const value = (payload as Record<string, unknown>).workspaceKey;
  return typeof value === "string" ? value.trim() : "";
}

export function readAgentName(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const value = (payload as Record<string, unknown>).agentName;
  return typeof value === "string" ? value.trim() : "";
}

export function readSessionKey(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const value = (payload as Record<string, unknown>).sessionKey;
  return typeof value === "string" ? value.trim() : "";
}

export function readWorkspaceFilePath(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const value = (payload as Record<string, unknown>).filePath;
  return typeof value === "string" ? value.trim() : "";
}

export function readWorkspaceSkillSpec(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const value = (payload as Record<string, unknown>).spec;
  return typeof value === "string" ? value.trim() : "";
}

export function readWorkspaceLabel(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const value = (payload as Record<string, unknown>).label;
  return typeof value === "string" ? value.trim() : "";
}

export function readWorkspaceFileContent(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const value = (payload as Record<string, unknown>).content;
  return typeof value === "string" ? value : undefined;
}

export function readMcpServers(
  payload: unknown,
): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const value = (payload as Record<string, unknown>).servers;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  if (Object.keys(value as object).length === 0) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function readMcpServerKeys(payload: unknown): string[] | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const value = (payload as Record<string, unknown>).keys;
  if (!Array.isArray(value)) {
    return undefined;
  }
  const keys = value.filter(
    (k): k is string => typeof k === "string" && k.trim().length > 0,
  );
  return keys.length > 0 ? keys : undefined;
}

export function readAuthProvider(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "openai";
  }
  const value = (payload as Record<string, unknown>).provider;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : "openai";
}

export function readAuthSessionId(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const value = (payload as Record<string, unknown>).sessionId;
  return typeof value === "string" ? value.trim() : "";
}

export function readAuthInput(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const value = (payload as Record<string, unknown>).input;
  return typeof value === "string" ? value : undefined;
}

export function readAuthEnter(payload: unknown): boolean | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  return (payload as Record<string, unknown>).enter === true ? true : undefined;
}

export function readAuthKind(payload: unknown): "apikey" | "subscription" | "" {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const value = (payload as Record<string, unknown>).kind;
  return value === "apikey" || value === "subscription" ? value : "";
}

export function readAuthModel(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const value = (payload as Record<string, unknown>).model;
  return typeof value === "string" ? value.trim() : "";
}

export function isLikelyE164(value: string): boolean {
  return /^\+[1-9]\d{5,19}$/.test(value);
}

export function partitionPendingDevices(output: string): {
  userRequestIds: string[];
  repairRequestIds: string[];
} {
  if (!output) return { userRequestIds: [], repairRequestIds: [] };
  try {
    const parsed = JSON.parse(output) as {
      pending?: Array<{ requestId?: unknown }>;
      [requestId: string]: unknown;
    };
    if (Array.isArray(parsed.pending)) {
      return {
        userRequestIds: uniqueIds(
          parsed.pending.map((item) =>
            typeof item?.requestId === "string" ? item.requestId.trim() : "",
          ),
        ),
        repairRequestIds: [],
      };
    }
    const entries = Object.values(parsed).filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === "object" && !Array.isArray(item),
    );
    if (entries.length > 0) {
      return {
        userRequestIds: uniqueIds(
          entries.filter((e) => e.isRepair !== true).map(toRequestId),
        ),
        repairRequestIds: uniqueIds(
          entries.filter((e) => e.isRepair === true).map(toRequestId),
        ),
      };
    }
  } catch {
    // Fallback to legacy text parsing if JSON output is unavailable.
  }
  const collapsed = output.replace(/-\s*\n\s*/g, "-");
  const matches =
    collapsed.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    ) ?? [];
  return { userRequestIds: Array.from(new Set(matches)), repairRequestIds: [] };
}

function toRequestId(item: Record<string, unknown>): string {
  return typeof item.requestId === "string" ? item.requestId.trim() : "";
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter((id) => id.length > 0)));
}

export function extractPendingDeviceRequestIds(output: string): string[] {
  return partitionPendingDevices(output).userRequestIds;
}

export function extractRepairRequestIds(output: string): string[] {
  return partitionPendingDevices(output).repairRequestIds;
}

/**
 * Files an `openclaw exec` command asks the Worker to write into the
 * workspace, in order, before the agent process starts. Entries that are not
 * `{ filePath: string; content: string }` are rejected rather than silently
 * turning into a partial write set.
 */
export function readFilesToWrite(
  payload: unknown,
): Array<{ filePath: string; content: string }> | null {
  if (!payload || typeof payload !== "object") return [];
  const value = (payload as Record<string, unknown>).filesToWrite;
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const files: Array<{ filePath: string; content: string }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const { filePath, content } = entry as Record<string, unknown>;
    if (typeof filePath !== "string" || filePath.trim().length === 0) return null;
    if (typeof content !== "string") return null;
    files.push({ filePath: filePath.trim(), content });
  }
  return files;
}
