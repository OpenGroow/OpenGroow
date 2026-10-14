import { env } from "./env.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Resolves the URL Convex itself uses to call an MCP server directly
 * (activation/reconfiguration/review calls) — as opposed to `url`, which is
 * what the OpenClaw runtime container uses and already targets
 * `host.docker.internal` for locally-run MCP servers.
 *
 * Templates author `activationUrl` assuming Convex runs directly on the
 * host (e.g. `npx convex dev`), where `localhost` reaches a locally-run MCP
 * server. When Convex itself runs inside Docker (the self-host stack,
 * `IS_SELF_HOST=1`), `localhost` resolves to the Convex container instead of
 * the host — so loopback hosts are rewritten to `host.docker.internal` in
 * that case.
 */
export function resolveMcpActivationUrl(server: { activationUrl?: string; url: string }): string {
  const raw = server.activationUrl ?? server.url;
  return env.IS_SELF_HOST ? rewriteLoopbackForContainer(raw) : raw;
}

/**
 * Points a loopback URL at the Docker host (`host.docker.internal`), the only
 * way a container reaches a process on the host. Other URLs, and strings that
 * are not URLs, are returned unchanged.
 */
export function rewriteLoopbackForContainer(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) return raw;
  parsed.hostname = "host.docker.internal";
  return parsed.toString();
}
