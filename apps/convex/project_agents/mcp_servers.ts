import type { AgentTemplate } from "@opengroow/agent-templates";
import { resolveMcpActivationUrl } from "../mcp_activation_url.js";

export function deepMergeRecords(
  base: Record<string, Record<string, unknown>>,
  patches: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = { ...base };
  for (const [key, patch] of Object.entries(patches)) {
    result[key] = { ...(base[key] ?? {}), ...patch };
  }
  return result;
}

export type ResolvedMcpServers = {
  servers: Record<string, Record<string, unknown>>;
  activationUrls: Record<string, string | undefined>;
};

export function resolveMcpServers(template: AgentTemplate): ResolvedMcpServers {
  const servers: Record<string, Record<string, unknown>> = {};
  const activationUrls: Record<string, string | undefined> = {};
  for (const serverConfig of template.manifest.mcpServers) {
    const { name, activationUrl: _activationUrl, publicBaseUrl: _publicBaseUrl, headers: _headers, ...runtimeConfig } = serverConfig;
    // Strip Convex-only fields — they are not sent to openclaw.json
    servers[name] = runtimeConfig;
    activationUrls[name] = resolveMcpActivationUrl(serverConfig);
  }
  return { servers, activationUrls };
}
