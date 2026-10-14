"use node";

import type { AgentTemplate } from "@opengroow/agent-templates";
import { resolveMcpActivationUrl } from "./mcp_activation_url.js";

/**
 * Resolve the MCP URL and auth headers for calling a Template-declared MCP
 * server directly from Convex (status-check calls, External Job polling).
 * Shared by External Job polling (ADR-020/026, Missions and Source
 * enrichment) and `project_agents/status_check.ts` (Config Completeness,
 * issue #320, ADR-034) — all call an MCP tool from Convex the same way. The
 * caller resolves the Template through the registry (`getTemplateRegistry`).
 */
export function resolveTemplateMcpEndpoint(
  template: AgentTemplate,
  serverName: string,
  apiKey?: string,
): { mcpUrl: string; headers: Record<string, string> } {
  const templateId = template.manifest.id;
  const server = template.manifest.mcpServers.find((s) => s.name === serverName);
  if (!server) throw new Error(`${serverName} not found in template ${templateId} manifest`);
  const mcpUrl = resolveMcpActivationUrl(server);
  if (!mcpUrl) throw new Error(`No URL configured for ${serverName}`);
  const headers = {
    ...(server.headers ?? {}),
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
  return { mcpUrl, headers };
}
