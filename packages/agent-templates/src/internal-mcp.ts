/**
 * The Internal MCP (ADR-080): the MCP server OpenGroow itself serves from
 * Convex. A Template declares it among its `mcpServers` with the tools it may
 * call, and never its URL.
 *
 * `INTERNAL_MCP_TOOL_NAMES` is the list of names a Template may declare. The
 * tool definitions live in Convex (`apps/convex/internal_mcp/catalog.ts`),
 * typed on this list so a name without a definition does not compile.
 */
export const INTERNAL_MCP_TOOL_NAMES = ["list_mission_types", "get_analytics_summary", "list_publications", "list_recent_missions", "get_brand_core", "list_production_recipes", "get_strategic_memory", "list_sources", "list_planned_contents"] as const;

export type InternalMcpToolName = (typeof INTERNAL_MCP_TOOL_NAMES)[number];

export function isInternalMcpToolName(name: string): name is InternalMcpToolName {
  return (INTERNAL_MCP_TOOL_NAMES as readonly string[]).includes(name);
}

/** Why an Internal MCP declaration is invalid, or undefined when it is fine. `servers` are all the Template's raw `mcpServers`. */
export function internalMcpProblem(servers: readonly Record<string, unknown>[]): string | undefined {
  const internals = servers.filter((server) => server.internal !== undefined);
  if (internals.length === 0) return undefined;
  if (internals.length > 1) return "at most one mcpServers entry may be the Internal MCP";
  const server = internals[0];
  const at = `mcpServers[${JSON.stringify(server.name)}]`;
  if (servers.length > 1) {
    return `${at} is the Internal MCP: declare no other server next to it (its Agent token would be sent to every server)`;
  }
  if (server.transport !== "streamable-http") return `${at}.transport must be "streamable-http" for the Internal MCP`;
  for (const forbidden of ["url", "activationUrl", "publicBaseUrl", "headers"]) {
    // `url: ""` is the form validateManifest normalises to, so a validated manifest can be validated again.
    if (server[forbidden] !== undefined && !(forbidden === "url" && server.url === "")) {
      return `${at}.${forbidden} must not be set on the Internal MCP: OpenGroow derives its URL and token from the deployment`;
    }
  }
  const declaration = server.internal;
  if (!declaration || typeof declaration !== "object" || Array.isArray(declaration)) {
    return `${at}.internal must be an object with a "tools" list`;
  }
  const tools = (declaration as Record<string, unknown>).tools;
  if (!Array.isArray(tools) || tools.length === 0) return `${at}.internal.tools must be a non-empty list of tool names`;
  const seen = new Set<string>();
  for (const tool of tools) {
    if (typeof tool !== "string" || !isInternalMcpToolName(tool)) {
      return `${at}.internal.tools: unknown tool ${JSON.stringify(tool)} (available: ${INTERNAL_MCP_TOOL_NAMES.join(", ")})`;
    }
    if (seen.has(tool)) return `${at}.internal.tools lists ${JSON.stringify(tool)} twice`;
    seen.add(tool);
  }
  return undefined;
}
