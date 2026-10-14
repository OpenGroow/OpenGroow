import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../../");
const dockerDir = resolve(repoRoot, "apps/openclaw-docker-config/docker");

export type LocalControlConfig = {
  port: number;
  basePort: number;
  dockerDir: string;
  composeFiles: string[];
  gatewayImageRef: string;
  runtimeWorkerImageRef: string;
  brokerWsUrl?: string;
  dockerEventsEnabled: boolean;
  hmacMaxSkewMs: number;
  keysRaw?: string;
  // Set by the container image (it mounts docker.sock): the built-in default
  // key registry is then refused and an explicit non-default secret is required.
  requireExplicitKeys: boolean;
  // The broker's container name/in-container keys-file path (root
  // docker-compose.yml's `broker` service, project name "opengroow",
  // `docker compose` v2's default `<project>-<service>-1` naming). Used both
  // for broker key propagation (issue #307's Implementation Decisions,
  // spec'd in #303: `docker cp`/`docker restart` after regenerating the
  // OpenClaw-keys file) and for reading the shared broker container's own
  // logs/status directly by name (issue #308) — self-host runs exactly one
  // shared broker container, never one per instance, so it's never part of
  // any per-instance compose project this service manages.
  brokerContainer: string;
  brokerKeysFilePath: string;
};

export function loadLocalControlConfig(): LocalControlConfig {
  return {
    port: envNumber("OPENCLAW_LOCAL_CONTROL_PORT", 4610),
    basePort: envNumber("OPENCLAW_LOCAL_CONTROL_BASE_PORT", 19100),
    // In a container the compose files are bind-mounted at the SAME absolute
    // path as on the host (docker-compose.start.yml), because `docker compose`
    // runs here but the daemon resolves paths on the host.
    dockerDir: envString("OPENCLAW_LOCAL_CONTROL_DOCKER_DIR") ?? dockerDir,
    composeFiles: ["docker-compose.yml", "docker-compose.local.yml"],
    gatewayImageRef: envString("OPENCLAW_LOCAL_GATEWAY_IMAGE_TAG") ?? "opengroow/openclaw-gateway:local",
    runtimeWorkerImageRef:
      envString("OPENCLAW_LOCAL_RUNTIME_WORKER_IMAGE_TAG") ?? "opengroow/openclaw-runtime-worker:local",
    // Docker Desktop exposes the host through host.docker.internal. Keep the
    // override for CI/Linux/self-host deployments that provide their own URL.
    brokerWsUrl: envString("BROKER_WS_URL") ?? "ws://host.docker.internal:4300/openclaw",
    dockerEventsEnabled: envFlag("OPENCLAW_LOCAL_CONTROL_DOCKER_EVENTS", false),
    hmacMaxSkewMs: envNumber("OPENCLAW_LOCAL_CONTROL_HMAC_MAX_SKEW_MS", 0),
    keysRaw: envString("OPENCLAW_LOCAL_CONTROL_KEYS"),
    requireExplicitKeys: envFlag("OPENCLAW_LOCAL_CONTROL_REQUIRE_KEYS", false),
    brokerContainer: envString("OPENCLAW_LOCAL_CONTROL_BROKER_CONTAINER") ?? "opengroow-broker-1",
    brokerKeysFilePath:
      envString("OPENCLAW_LOCAL_CONTROL_BROKER_KEYS_FILE") ?? "/run/openclaw-secrets/openclaw-keys.json"
  };
}

function envFlag(name: string, fallback: boolean): boolean {
  const value = envString(name);
  if (!value) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function envString(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function envNumber(name: string, fallback: number): number {
  const value = envString(name);
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric env ${name}: ${value}`);
  }
  return parsed;
}
