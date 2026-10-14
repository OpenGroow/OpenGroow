import type { AgentTemplate } from "@opengroow/agent-templates";
import { rewriteLoopbackForContainer } from "./mcp_activation_url.js";

/** Operator URL overrides of a Template's MCP servers, by server name. */
export type McpUrlOverrides = Record<string, string>;

/**
 * Derives every view of an MCP server from the single URL the operator set
 * (#654), generalizing the loopback rewrite:
 * - `url`, what the OpenClaw runtime container calls: loopback becomes
 *   `host.docker.internal`;
 * - `activationUrl`, what Convex calls: the operator's URL, which Convex's
 *   own loopback rewrite (`resolveMcpActivationUrl`) makes reachable;
 * - `publicBaseUrl`, what the user's browser follows: the URL as typed.
 * An override naming a server the Template no longer declares is ignored.
 */
export function applyMcpUrlOverrides(template: AgentTemplate, overrides: McpUrlOverrides): AgentTemplate {
  if (!template.manifest.mcpServers.some((server) => overrides[server.name] !== undefined)) return template;
  return {
    ...template,
    manifest: {
      ...template.manifest,
      mcpServers: template.manifest.mcpServers.map((server) => {
        const url = overrides[server.name];
        if (url === undefined) return server;
        return { ...server, url: rewriteLoopbackForContainer(url), activationUrl: url, publicBaseUrl: url };
      }),
    },
  };
}
