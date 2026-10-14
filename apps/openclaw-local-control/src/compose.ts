import type { InstanceCredentials } from "./ids.js";
import type { LocalControlConfig } from "./config.js";

// One Docker Compose project per instance (issue #303's Implementation
// Decisions): Compose's automatic project-scoped volume naming gives
// per-instance volume isolation without renaming any volumes explicitly, as
// long as every invocation for an instance uses the same `-p` project name.
export function composeProjectName(instanceId: string): string {
  return `openclaw-${instanceId}`;
}

export type ComposeLogsOptions = {
  tail?: number;
  // "all" | "openclaw-gateway" | "openclaw-runtime-worker" — the local
  // equivalent of a remote control plane's log service
  // (docs/CONTROL_PLANE.md), forwarded here unvalidated
  // straight from instances_node.ts's LogsArgs.service via the HTTP body,
  // same as every other field on this request.
  service?: string;
};

export function buildComposeArgs(
  config: LocalControlConfig,
  instanceId: string,
  action: "up" | "down" | "logs" | "ps",
  logsOptions?: ComposeLogsOptions
): string[] {
  const fileArgs = config.composeFiles.flatMap((file) => ["-f", file]);
  const actionArgs = buildActionArgs(action, logsOptions);
  return ["-p", composeProjectName(instanceId), ...fileArgs, ...actionArgs];
}

function buildActionArgs(
  action: "up" | "down" | "logs" | "ps",
  logsOptions?: ComposeLogsOptions
): string[] {
  switch (action) {
    case "up":
      return ["up", "-d"];
    case "down":
      return ["down", "-v"];
    case "ps":
      return ["ps"];
    case "logs": {
      const tail = normalizeTail(logsOptions?.tail);
      const args = ["logs", "--tail", String(tail)];
      const service = logsOptions?.service?.trim();
      if (service && service !== "all") {
        args.push(service);
      }
      return args;
    }
  }
}

// Exported for reuse by broker.ts (issue #308): the shared broker
// container's logs go through plain `docker logs`, not compose, but want
// the same tail-normalization rules (bounded, falls back on garbage input).
export function normalizeTail(tail: number | undefined, fallback = 200): number {
  const value = Number(tail);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), 5000);
}

export function buildComposeUpEnv(
  config: LocalControlConfig,
  instanceId: string,
  port: number,
  credentials: InstanceCredentials
): Record<string, string> {
  return {
    OPENCLAW_IMAGE_REF: config.gatewayImageRef,
    OPENCLAW_RUNTIME_WORKER_IMAGE_REF: config.runtimeWorkerImageRef,
    OPENCLAW_INSTANCE_ID: instanceId,
    OPENCLAW_GATEWAY_PORT: String(port),
    OPENCLAW_KEY_ID: credentials.keyId,
    OPENCLAW_SECRET: credentials.secret,
    OPENCLAW_GATEWAY_TOKEN: credentials.gatewayToken,
    ...(config.brokerWsUrl ? { BROKER_WS_URL: config.brokerWsUrl } : {})
  };
}
