import type { AgentTemplate } from "@opengroow/agent-templates";
import { env } from "../env.js";
import { rewriteLoopbackForContainer } from "../mcp_activation_url.js";
import { generateAgentToken } from "./agent_token.js";

export const INTERNAL_MCP_PATH = "/internal-mcp";

/**
 * The Internal MCP's URL as the OpenClaw runtime reaches it (ADR-080). The
 * Template never holds it: it is the deployment's own Convex site address,
 * so it follows the configured site port (`CONVEX_SITE_PROXY_PORT` in
 * self-host). A loopback address is rewritten to `host.docker.internal`, which
 * the Gateway relays to the host; a public HTTPS address is used as is. A
 * private Docker network name would be refused by the runtime's SSRF guard.
 */
export function internalMcpRuntimeUrl(): string {
  const site = env.CONVEX_SITE_URL;
  if (!site) throw new Error("Cannot serve the Internal MCP: the deployment does not expose its Convex site address (CONVEX_SITE_URL)");
  return rewriteLoopbackForContainer(`${site.replace(/\/+$/, "")}${INTERNAL_MCP_PATH}`);
}

/**
 * The Agent's config to persist at activation. A Template declaring the Internal
 * MCP gets a fresh Agent token as `apiKey`, which the activation path writes as
 * the server's Authorization header. Each activation issues a new one: deactivating
 * and reactivating rotates it. Other Templates keep their config.
 */
export function withInternalMcpToken(
  template: AgentTemplate,
  instanceId: string,
  templateId: string,
  config: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!template.manifest.mcpServers.some((server) => server.internal)) return config;
  return { ...config, apiKey: generateAgentToken(instanceId, templateId) };
}
