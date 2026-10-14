export type ApiResponse = {
  status?: number;
  error?: string;
  job?: {
    id?: string;
    status?: string;
    openclaw?: {
      gatewayToken?: string;
      ipv4?: string;
      name?: string;
    };
  };
  [key: string]: unknown;
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

export type WhatsAppPairingState = {
  status?: string;
  output?: string;
  qrDataUrl?: string;
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

export type OpenClawCommandState = {
  status?: string;
  output?: string;
  error?: string;
  exitCode?: number | null;
};
