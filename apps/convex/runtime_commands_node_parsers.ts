import {
  RUNTIME_NODES_APPROVE_RESULT,
  RUNTIME_NODES_CHECK_RESULT,
  RUNTIME_NODES_PENDING_RESULT,
  RUNTIME_WHATSAPP_PAIR_START_RESULT,
  RUNTIME_WHATSAPP_PAIR_WAIT_RESULT,
  RUNTIME_WHATSAPP_CONFIG_SET_RESULT,
  RUNTIME_TELEGRAM_CONFIG_SET_RESULT,
  RUNTIME_AI_CONFIG_SET_RESULT,
  RUNTIME_SPEECH_TO_TEXT_CONFIG_SET_RESULT,
  RUNTIME_HEALTH_RESULT,
  RUNTIME_WORKSPACE_FILE_READ_RESULT,
  RUNTIME_WORKSPACE_LIST_RESULT,
  RUNTIME_WORKSPACE_SKILL_FILES_RESULT,
  RUNTIME_OPENCLAW_EXEC_CANCEL_RESULT,
  type RuntimeOpenClawExecCancelResultPayload,
  type RuntimeWhatsAppPairStartResultPayload,
  type RuntimeWhatsAppPairWaitResultPayload,
  type RuntimeNodesApproveResultPayload,
  type RuntimeNodesPendingResultPayload,
  type RuntimeWhatsAppConfigSetResultPayload,
  type RuntimeTelegramConfigSetResultPayload,
  type RuntimeAiConfigSetResultPayload,
  type RuntimeSpeechToTextConfigSetResultPayload,
  type RuntimeHealthResultPayload,
  type RuntimeWorkspaceFileReadResultPayload,
  type RuntimeWorkspaceListResultPayload,
  type RuntimeWorkspaceSkillFilesResultPayload,
} from "@opengroow/protocol";

export type RuntimeNodesCheckResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    connectedCount: number;
    repairing?: boolean;
    nodes: Array<{ displayName: string; caps: string[] }>;
  };
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function parseRuntimeNodesPendingPayload(
  type: string | undefined,
  payload: unknown,
): RuntimeNodesPendingResultPayload | null {
  if (type !== RUNTIME_NODES_PENDING_RESULT) return null;
  const envelope = record(payload);
  const data = record(envelope?.data);
  if (
    !envelope ||
    typeof envelope.commandId !== "string" ||
    typeof envelope.instanceId !== "string" ||
    typeof envelope.ok !== "boolean" ||
    (envelope.error !== undefined && typeof envelope.error !== "string") ||
    typeof data?.output !== "string" ||
    !Array.isArray(data.requestIds) ||
    data.requestIds.some((value) => typeof value !== "string")
  ) {
    return null;
  }
  return {
    commandId: envelope.commandId,
    instanceId: envelope.instanceId,
    ok: envelope.ok,
    error: typeof envelope.error === "string" ? envelope.error : undefined,
    data: {
      output: data.output,
      requestIds: data.requestIds as string[],
    },
  };
}

export function parseRuntimeNodesApprovePayload(
  type: string | undefined,
  payload: unknown,
): RuntimeNodesApproveResultPayload | null {
  if (type !== RUNTIME_NODES_APPROVE_RESULT) return null;
  const envelope = record(payload);
  const data = record(envelope?.data);
  if (
    !envelope ||
    typeof envelope.commandId !== "string" ||
    typeof envelope.instanceId !== "string" ||
    typeof envelope.ok !== "boolean" ||
    (envelope.error !== undefined && typeof envelope.error !== "string") ||
    typeof data?.output !== "string" ||
    typeof data.requestId !== "string"
  ) {
    return null;
  }
  return {
    commandId: envelope.commandId,
    instanceId: envelope.instanceId,
    ok: envelope.ok,
    error: typeof envelope.error === "string" ? envelope.error : undefined,
    data: { output: data.output, requestId: data.requestId },
  };
}

export function parseRuntimeNodesCheckPayload(
  type: string | undefined,
  payload: unknown,
): RuntimeNodesCheckResultPayload | null {
  if (type !== RUNTIME_NODES_CHECK_RESULT) return null;
  const envelope = record(payload);
  const data = record(envelope?.data);
  const rawNodes = data?.nodes;
  if (
    !envelope ||
    typeof envelope.commandId !== "string" ||
    typeof envelope.instanceId !== "string" ||
    typeof envelope.ok !== "boolean" ||
    (envelope.error !== undefined && typeof envelope.error !== "string") ||
    typeof data?.connectedCount !== "number" ||
    !Array.isArray(rawNodes)
  ) {
    return null;
  }
  const nodes = rawNodes.map((value) => {
    const node = record(value);
    if (
      !node ||
      typeof node.displayName !== "string" ||
      !Array.isArray(node.caps) ||
      node.caps.some((cap) => typeof cap !== "string")
    ) {
      return null;
    }
    return {
      displayName: node.displayName,
      caps: node.caps as string[],
    };
  });
  if (nodes.some((node) => node === null)) return null;
  return {
    commandId: envelope.commandId,
    instanceId: envelope.instanceId,
    ok: envelope.ok,
    error: typeof envelope.error === "string" ? envelope.error : undefined,
    data: {
      connectedCount: data.connectedCount,
      repairing: data.repairing === true,
      nodes: nodes as Array<{ displayName: string; caps: string[] }>,
    },
  };
}

function parseRuntimeWorkspaceFileEntry(value: unknown) {
  const entry = record(value);
  const filePath = stringValue(entry?.filePath);
  const title = stringValue(entry?.title);
  const kind = stringValue(entry?.kind);
  if (
    !filePath ||
    !title ||
    (kind !== "standard" && kind !== "memory" && kind !== "mission" && kind !== "skill")
  ) {
    return null;
  }
  return { filePath, title, kind } as const;
}

export function parseRuntimeWorkspaceListPayload(
  type: string | undefined,
  payload: unknown,
): RuntimeWorkspaceListResultPayload | null {
  if (type !== RUNTIME_WORKSPACE_LIST_RESULT) return null;
  const envelope = record(payload);
  const data = record(envelope?.data);
  if (
    !envelope ||
    typeof envelope.commandId !== "string" ||
    typeof envelope.instanceId !== "string" ||
    typeof envelope.ok !== "boolean" ||
    (envelope.error !== undefined && typeof envelope.error !== "string") ||
    !Array.isArray(data?.workspaces)
  ) {
    return null;
  }

  const workspaces = data.workspaces.map((value) => {
    const workspace = record(value);
    const workspaceKey = stringValue(workspace?.workspaceKey);
    const label = stringValue(workspace?.label);
    const absolutePath = stringValue(workspace?.absolutePath);
    const kind = stringValue(workspace?.kind);
    const files = Array.isArray(workspace?.availableFiles)
      ? workspace.availableFiles.map(parseRuntimeWorkspaceFileEntry)
      : null;
    if (
      !workspaceKey ||
      !label ||
      !absolutePath ||
      !files ||
      files.some((file) => file === null) ||
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
      isActive: workspace?.isActive === true,
      kind,
      availableFiles: files,
    };
  });
  if (workspaces.some((workspace) => workspace === null)) return null;

  return {
    commandId: envelope.commandId,
    instanceId: envelope.instanceId,
    ok: envelope.ok,
    error: typeof envelope.error === "string" ? envelope.error : undefined,
    data: { workspaces: workspaces as RuntimeWorkspaceListResultPayload["data"]["workspaces"] },
  };
}

export function parseRuntimeWorkspaceSkillFilesPayload(
  type: string | undefined,
  payload: unknown,
): RuntimeWorkspaceSkillFilesResultPayload | null {
  if (type !== RUNTIME_WORKSPACE_SKILL_FILES_RESULT) return null;
  const envelope = record(payload);
  const data = record(envelope?.data);
  if (
    !envelope ||
    typeof envelope.commandId !== "string" ||
    typeof envelope.instanceId !== "string" ||
    typeof envelope.ok !== "boolean" ||
    (envelope.error !== undefined && typeof envelope.error !== "string") ||
    typeof data?.workspaceKey !== "string" ||
    typeof data.spec !== "string" ||
    !Array.isArray(data.files)
  ) {
    return null;
  }
  const files = data.files.map(parseRuntimeWorkspaceFileEntry);
  if (files.some((file) => file === null)) return null;
  return {
    commandId: envelope.commandId,
    instanceId: envelope.instanceId,
    ok: envelope.ok,
    error: typeof envelope.error === "string" ? envelope.error : undefined,
    data: {
      workspaceKey: data.workspaceKey,
      spec: data.spec,
      files: files as RuntimeWorkspaceSkillFilesResultPayload["data"]["files"],
    },
  };
}

export function parseRuntimeWorkspaceFileReadPayload(
  type: string | undefined,
  payload: unknown,
): RuntimeWorkspaceFileReadResultPayload | null {
  if (type !== RUNTIME_WORKSPACE_FILE_READ_RESULT) {
    return null;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const payloadRecord = payload as Record<string, unknown>;
  if (
    typeof payloadRecord.commandId !== "string" ||
    typeof payloadRecord.instanceId !== "string" ||
    typeof payloadRecord.ok !== "boolean" ||
    (payloadRecord.error !== undefined &&
      typeof payloadRecord.error !== "string")
  ) {
    return null;
  }

  const data = payloadRecord.data;
  if (!data || typeof data !== "object") {
    return null;
  }
  const dataRecord = data as Record<string, unknown>;
  if (
    typeof dataRecord.workspaceKey !== "string" ||
    typeof dataRecord.filePath !== "string" ||
    typeof dataRecord.title !== "string" ||
    typeof dataRecord.content !== "string" ||
    (dataRecord.lastModifiedAt !== undefined &&
      typeof dataRecord.lastModifiedAt !== "string")
  ) {
    return null;
  }

  return {
    commandId: payloadRecord.commandId,
    instanceId: payloadRecord.instanceId,
    ok: payloadRecord.ok,
    error:
      typeof payloadRecord.error === "string"
        ? payloadRecord.error
        : undefined,
    data: {
      workspaceKey: dataRecord.workspaceKey,
      filePath: dataRecord.filePath,
      title: dataRecord.title,
      content: dataRecord.content,
      lastModifiedAt:
        typeof dataRecord.lastModifiedAt === "string"
          ? dataRecord.lastModifiedAt
          : undefined,
    },
  };
}

export function parseRuntimeHealthPayload(
  type: string | undefined,
  payload: unknown,
): RuntimeHealthResultPayload | null {
  if (type !== RUNTIME_HEALTH_RESULT) {
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
    commandId:
      typeof payloadRecord.commandId === "string"
        ? payloadRecord.commandId
        : "",
    instanceId:
      typeof payloadRecord.instanceId === "string"
        ? payloadRecord.instanceId
        : "",
    ok: payloadRecord.ok === true,
    error:
      typeof payloadRecord.error === "string" ? payloadRecord.error : undefined,
    data: {
      output: typeof data.output === "string" ? data.output : "",
    },
  };
}

export function parseRuntimeOpenClawExecPayload(
  type: string | undefined,
  payload: unknown,
):
  | {
      ok: boolean;
      error?: string;
      data: { output: string; commandText?: string; exitCode?: number | null };
    }
  | null {
  if (type !== "runtime.openclaw.exec.result") {
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
    data: {
      output: typeof data.output === "string" ? data.output.trim() : "",
      commandText: typeof data.commandText === "string" ? data.commandText : undefined,
      exitCode:
        typeof data.exitCode === "number" || data.exitCode === null
          ? data.exitCode
          : undefined,
    },
  };
}

export function parseRuntimeOpenClawExecCancelPayload(
  type: string | undefined,
  payload: unknown,
): RuntimeOpenClawExecCancelResultPayload | null {
  if (type !== RUNTIME_OPENCLAW_EXEC_CANCEL_RESULT) {
    return null;
  }
  const payloadRecord = record(payload);
  if (!payloadRecord) return null;
  const ok = payloadRecord.ok !== false;
  const data = record(payloadRecord.data) ?? {};
  // On an `ok: true` result, `data.cancelled` must be an actual boolean
  // (control-socket-openclaw-workflow.js's `cancel` always writes one — see
  // its comment on why `false` there is the legitimate idempotent "nothing
  // to kill" outcome, not an error). A missing/corrupted field on an `ok:
  // true` result means the payload itself is malformed, so reject it here
  // rather than silently coercing it to `false` and letting the caller
  // (cancelMission) treat a garbled response as a clean cancel.
  if (ok && typeof data.cancelled !== "boolean") return null;
  return {
    commandId: stringValue(payloadRecord.commandId) ?? "",
    instanceId: stringValue(payloadRecord.instanceId) ?? "",
    ok,
    error: typeof payloadRecord.error === "string" ? payloadRecord.error : undefined,
    data: { cancelled: data.cancelled === true },
  };
}

export function parseRuntimeWhatsAppPairPayload(
  type: string | undefined,
  payload: unknown,
):
  | RuntimeWhatsAppPairStartResultPayload
  | RuntimeWhatsAppPairWaitResultPayload
  | null {
  if (
    type !== RUNTIME_WHATSAPP_PAIR_START_RESULT &&
    type !== RUNTIME_WHATSAPP_PAIR_WAIT_RESULT
  ) {
    return null;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const payloadRecord = payload as Record<string, unknown>;
  const data = payloadRecord.data;
  if (!data || typeof data !== "object") {
    return null;
  }

  const dataRecord = data as Record<string, unknown>;
  const base = {
    commandId:
      typeof payloadRecord.commandId === "string"
        ? payloadRecord.commandId
        : "",
    instanceId:
      typeof payloadRecord.instanceId === "string"
        ? payloadRecord.instanceId
        : "",
    ok: payloadRecord.ok !== false,
    error:
      typeof payloadRecord.error === "string" ? payloadRecord.error : undefined,
    data: {
      output: typeof dataRecord.output === "string" ? dataRecord.output : "",
      linked: dataRecord.linked === true,
      connected: dataRecord.connected === true,
    },
  };

  // Both results carry a QR: WhatsApp rotates it every ~20 s, and each check
  // answers with the current one.
  return {
    ...base,
    data: {
      ...base.data,
      qrDataUrl:
        typeof dataRecord.qrDataUrl === "string"
          ? dataRecord.qrDataUrl
          : undefined,
      qrExpiresInMs:
        typeof dataRecord.qrExpiresInMs === "number" && Number.isFinite(dataRecord.qrExpiresInMs)
          ? Math.max(0, dataRecord.qrExpiresInMs)
          : undefined,
    },
  };
}

export function parseRuntimeWhatsAppConfigPayload(
  type: string | undefined,
  payload: unknown,
): RuntimeWhatsAppConfigSetResultPayload | null {
  if (type !== RUNTIME_WHATSAPP_CONFIG_SET_RESULT) {
    return null;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const payloadRecord = payload as Record<string, unknown>;
  const data = payloadRecord.data;
  if (!data || typeof data !== "object") {
    return null;
  }

  const dataRecord = data as Record<string, unknown>;
  return {
    commandId:
      typeof payloadRecord.commandId === "string"
        ? payloadRecord.commandId
        : "",
    instanceId:
      typeof payloadRecord.instanceId === "string"
        ? payloadRecord.instanceId
        : "",
    ok: payloadRecord.ok !== false,
    error:
      typeof payloadRecord.error === "string" ? payloadRecord.error : undefined,
    data: {
      output: typeof dataRecord.output === "string" ? dataRecord.output : "",
      phoneNumber:
        typeof dataRecord.phoneNumber === "string"
          ? dataRecord.phoneNumber
          : undefined,
      enabled:
        typeof dataRecord.enabled === "boolean" ? dataRecord.enabled : undefined,
    },
  };
}

export function parseRuntimeTelegramConfigPayload(
  type: string | undefined,
  payload: unknown,
): RuntimeTelegramConfigSetResultPayload | null {
  if (type !== RUNTIME_TELEGRAM_CONFIG_SET_RESULT) {
    return null;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const payloadRecord = payload as Record<string, unknown>;
  const data = payloadRecord.data;
  if (!data || typeof data !== "object") {
    return null;
  }

  const dataRecord = data as Record<string, unknown>;
  return {
    commandId:
      typeof payloadRecord.commandId === "string"
        ? payloadRecord.commandId
        : "",
    instanceId:
      typeof payloadRecord.instanceId === "string"
        ? payloadRecord.instanceId
        : "",
    ok: payloadRecord.ok !== false,
    error:
      typeof payloadRecord.error === "string" ? payloadRecord.error : undefined,
    data: {
      output: typeof dataRecord.output === "string" ? dataRecord.output : "",
    },
  };
}

export function parseRuntimeAiConfigPayload(
  type: string | undefined,
  payload: unknown,
): RuntimeAiConfigSetResultPayload | null {
  if (type !== RUNTIME_AI_CONFIG_SET_RESULT) {
    return null;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const payloadRecord = payload as Record<string, unknown>;
  const data = payloadRecord.data;
  if (!data || typeof data !== "object") {
    return null;
  }

  const dataRecord = data as Record<string, unknown>;
  return {
    commandId:
      typeof payloadRecord.commandId === "string"
        ? payloadRecord.commandId
        : "",
    instanceId:
      typeof payloadRecord.instanceId === "string"
        ? payloadRecord.instanceId
        : "",
    ok: payloadRecord.ok !== false,
    error:
      typeof payloadRecord.error === "string" ? payloadRecord.error : undefined,
    data: {
      output: typeof dataRecord.output === "string" ? dataRecord.output : "",
      provider:
        typeof dataRecord.provider === "string" ? dataRecord.provider : undefined,
      model:
        typeof dataRecord.model === "string" ? dataRecord.model : undefined,
      baseUrl:
        typeof dataRecord.baseUrl === "string" ? dataRecord.baseUrl : undefined,
    },
  };
}

export function parseRuntimeSpeechToTextConfigPayload(
  type: string | undefined,
  payload: unknown,
): RuntimeSpeechToTextConfigSetResultPayload | null {
  if (type !== RUNTIME_SPEECH_TO_TEXT_CONFIG_SET_RESULT) {
    return null;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const payloadRecord = payload as Record<string, unknown>;
  const data = payloadRecord.data;
  if (!data || typeof data !== "object") {
    return null;
  }

  const dataRecord = data as Record<string, unknown>;
  return {
    commandId:
      typeof payloadRecord.commandId === "string"
        ? payloadRecord.commandId
        : "",
    instanceId:
      typeof payloadRecord.instanceId === "string"
        ? payloadRecord.instanceId
        : "",
    ok: payloadRecord.ok !== false,
    error:
      typeof payloadRecord.error === "string" ? payloadRecord.error : undefined,
    data: {
      output: typeof dataRecord.output === "string" ? dataRecord.output : "",
      provider:
        typeof dataRecord.provider === "string"
          ? dataRecord.provider
          : "groq",
      enabled: dataRecord.enabled === true,
    },
  };
}
