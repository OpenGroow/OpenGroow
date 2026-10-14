type EnvSource = NodeJS.ProcessEnv;

export type RuntimeWorkerConfig = {
  brokerWsUrl: string;
  openclawKeyId: string;
  openclawSecret: string;
  openclawControlSocketPath: string;
  openclawGatewayLocalPort: number;
  openclawInstanceId: string;
  openclawConfigDir: string;
};

function requireNonEmpty(env: EnvSource, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${key}`);
  }
  return value;
}

function parsePositiveInteger(raw: string, key: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Environment variable ${key} must be a positive integer`);
  }
  return value;
}

function requireBrokerWsUrl(env: EnvSource): string {
  const brokerWsUrl = requireNonEmpty(env, "BROKER_WS_URL");
  let parsed: URL;
  try {
    parsed = new URL(brokerWsUrl);
  } catch {
    throw new Error("Environment variable BROKER_WS_URL must be a valid URL");
  }

  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error("Environment variable BROKER_WS_URL must use ws:// or wss://");
  }
  return parsed.toString();
}

function requireGatewayLocalPort(env: EnvSource): number {
  const portValue =
    env.OPENCLAW_GATEWAY_LOCAL_PORT?.trim() ??
    env.OPENCLAW_GATEWAY_PORT?.trim();

  if (!portValue) {
    throw new Error(
      "Missing required environment variable OPENCLAW_GATEWAY_LOCAL_PORT or OPENCLAW_GATEWAY_PORT",
    );
  }

  return parsePositiveInteger(
    portValue,
    env.OPENCLAW_GATEWAY_LOCAL_PORT?.trim()
      ? "OPENCLAW_GATEWAY_LOCAL_PORT"
      : "OPENCLAW_GATEWAY_PORT",
  );
}

export function loadRuntimeWorkerConfig(
  env: EnvSource = process.env,
): RuntimeWorkerConfig {
  return {
    brokerWsUrl: requireBrokerWsUrl(env),
    openclawKeyId: requireNonEmpty(env, "OPENCLAW_KEY_ID"),
    openclawSecret: requireNonEmpty(env, "OPENCLAW_SECRET"),
    openclawControlSocketPath: requireNonEmpty(
      env,
      "OPENCLAW_CONTROL_SOCKET_PATH",
    ),
    openclawGatewayLocalPort: requireGatewayLocalPort(env),
    openclawInstanceId: requireNonEmpty(env, "OPENCLAW_INSTANCE_ID"),
    openclawConfigDir: env.OPENCLAW_CONFIG_DIR?.trim() || "/home/node/.openclaw",
  };
}
