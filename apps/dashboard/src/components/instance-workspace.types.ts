import type {
  RuntimeWorkspaceKind,
  RuntimeWorkspaceFileEntry,
  RuntimeWorkspaceDescriptor,
} from "@opengroow/protocol";

export type InstanceWorkspaceProps = {
  instanceId: string;
};

export type InstanceView =
  | "overview"
  | "brand"
  | "test"
  | "agents"
  | "missions"
  | "sources"
  | "jobs"
  | "schedules"
  | "developer"
  | "settings";

export type InstanceRecord = {
  _id: string;
  jobId: string;
  status: string;
  runtimeStatus?: string;
  runtimeReady?: boolean;
  runtimeStatusUpdatedAt?: string;
  runtimeStatusError?: string;
  error?: string;
  displayName?: string;
  openclawName?: string;
  openclawId?: string;
  openclawServerId?: number;
  brokerServerId?: number;
  ipv4?: string;
  openclawGatewayToken?: string;
  openclawVersion?: string;
  openclawVersionUpdatedAt?: string;
  providers?: Array<{
    kind: "subscription" | "apikey";
    provider: string;
    model: string;
    baseUrl?: string;
    inUse: boolean;
    updatedAt: string;
  }>;
  whatsAppChannel?: {
    linked: boolean;
    connected: boolean;
    phoneNumber?: string;
    enabled?: boolean;
    autoDisabledReason?: string;
    updatedAt: string;
  };
  telegramChannel?: {
    configured: boolean;
    updatedAt: string;
  };
  speechToText?: {
    provider: string;
    enabled: boolean;
    updatedAt: string;
  };
  workspaceList?: {
    workspaces: Array<{
      workspaceKey: string;
      label: string;
      absolutePath: string;
      isActive: boolean;
      kind: string;
      availableFiles: Array<{ filePath: string; title: string; kind: string }>;
    }>;
    updatedAt: string;
  };
  updatedAt?: string;
};

export type WhatsAppPairingState = {
  status?: string;
  output?: string;
  qrDataUrl?: string;
  // Browser clock time at which qrDataUrl stops being valid (the Instance
  // reports the time left, so clocks need not agree).
  qrExpiresAtMs?: number;
  linked?: boolean;
  connected?: boolean;
  error?: string;
};

export type WhatsAppConfigState = {
  status?: string;
  output?: string;
  error?: string;
  phoneNumber?: string;
};

export type TelegramConfigState = {
  status?: string;
  output?: string;
  error?: string;
};

export type AiConfigState = {
  status?: string;
  output?: string;
  error?: string;
  provider?: string;
  model?: string;
};

export type SpeechToTextConfigState = {
  status?: "saving" | "saved" | "error";
  output?: string;
  error?: string;
};

export type WorkspaceStatusTone = "success" | "muted";

export type AuthJobState = {
  id?: string;
  status?: string;
  logs?: string[];
  error?: string;
  awaitingResume?: boolean;
};

export type ConnectTicketState = {
  status?: string;
  error?: string;
  ticket?: {
    id: string;
    instanceId: string;
    openclawName?: string;
    ipv4?: string;
    serverId?: number;
    createdAt: string;
    expiresAt: string;
    connectUrl: string;
    gatewayHttpBaseUrl: string;
    gatewayWsBaseUrl: string;
    gatewayToken: string;
    nodeGatewayHost: string;
    nodeGatewayPort: number;
    nodeGatewayTls: boolean;
    nodeGatewayToken: string;
    nodeRunCommand: string;
  };
};

export type ConnectSessionPhase =
  | "waiting_for_device"
  | "approval_required"
  | "reconnecting"
  | "connected"
  | "failed"
  | "expired";

export type ConnectSessionStatus = {
  ticketId: string;
  phase: ConnectSessionPhase;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  connectedAt?: string;
  error?: string;
};

export type ParsedNodesPayload = {
  ok: boolean;
  error?: string;
  output: string;
  requestIds: string[];
};

export type ParsedOpenClawExecPayload = {
  ok: boolean;
  error?: string;
  output: string;
  commandText?: string;
  exitCode?: number | null;
};

export type ParsedWorkspaceListPayload = {
  ok: boolean;
  error?: string;
  workspaces: RuntimeWorkspaceDescriptor[];
};

export type ParsedWorkspaceFilePayload = {
  ok: boolean;
  error?: string;
  workspaceKey: string;
  filePath: string;
  title: string;
  content: string;
  lastModifiedAt?: string;
};

export type ParsedWorkspaceSkillFilesPayload = {
  ok: boolean;
  error?: string;
  workspaceKey: string;
  spec: string;
  files: RuntimeWorkspaceFileEntry[];
};

export type RefreshedOpenClawVersionResult = {
  ok: boolean;
  version?: string;
  output: string;
  error?: string;
  updatedAt?: string;
};
