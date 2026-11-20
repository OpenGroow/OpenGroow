import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "../_generated/server.js";
import { getTemplateRegistry } from "../template_registry.js";
import { INTERNAL_MCP_CATALOG, catalogTool, type InternalMcpScope } from "./catalog.js";
import { parseAgentToken, tokensMatch } from "./agent_token.js";
import { hasRunInProgress } from "./run_liveness.js";

/**
 * Everything the Internal MCP decides, in one transaction (ADR-080): who the
 * token belongs to, whether that Agent has a Run in progress, which tools its
 * Template declares, and the tool itself. The HTTP layer only speaks JSON-RPC.
 */
export type InternalMcpOutcome =
  | { kind: "refused"; status: 401 | 403; message: string }
  | { kind: "ok" }
  | { kind: "tools"; tools: { name: string; description: string; inputSchema: Record<string, unknown>; annotations: { readOnlyHint: true } }[] }
  | { kind: "unknown_tool"; name: string }
  | { kind: "tool_result"; text: string; isError: boolean };

const UNAUTHORIZED: InternalMcpOutcome = { kind: "refused", status: 401, message: "Invalid or missing Agent token" };

/** The Agent behind a valid token and the tools its Template declares; undefined for any invalid token. */
async function authenticate(ctx: QueryCtx, token: string): Promise<{ scope: InternalMcpScope; declaredTools: Set<string> } | undefined> {
  const claimed = parseAgentToken(token);
  if (!claimed) return undefined;
  const agent = await ctx.db
    .query("projectAgents")
    .withIndex("by_instance_template", (q) => q.eq("instanceId", claimed.instanceId).eq("templateId", claimed.templateId))
    .unique();
  const stored = agent?.config?.apiKey;
  if (!agent || agent.status !== "active" || typeof stored !== "string" || !tokensMatch(token, stored)) return undefined;
  const template = await getTemplateRegistry(ctx).resolve(claimed.instanceId, claimed.templateId);
  const declaration = template?.manifest.mcpServers.find((server) => server.internal)?.internal;
  if (!declaration) return undefined;
  return { scope: claimed, declaredTools: new Set(declaration.tools) };
}

export const handle = internalQuery({
  args: {
    token: v.string(),
    method: v.union(v.literal("initialize"), v.literal("tools/list"), v.literal("tools/call")),
    toolName: v.optional(v.string()),
    toolArguments: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<InternalMcpOutcome> => {
    const agent = await authenticate(ctx, args.token);
    if (!agent) return UNAUTHORIZED;
    if (args.method === "initialize") return { kind: "ok" };

    if (!(await hasRunInProgress(ctx, agent.scope.instanceId, agent.scope.templateId))) {
      return { kind: "refused", status: 403, message: "The Agent has no Run in progress" };
    }

    if (args.method === "tools/list") {
      return {
        kind: "tools",
        tools: Object.entries(INTERNAL_MCP_CATALOG)
          .filter(([name]) => agent.declaredTools.has(name))
          .map(([name, tool]) => ({ name, description: tool.description, inputSchema: tool.inputSchema, annotations: { readOnlyHint: true as const } })),
      };
    }

    const name = args.toolName ?? "";
    const tool = agent.declaredTools.has(name) ? catalogTool(name) : undefined;
    if (!tool) return { kind: "unknown_tool", name };
    const toolArguments = args.toolArguments && typeof args.toolArguments === "object" && !Array.isArray(args.toolArguments) ? args.toolArguments : {};
    try {
      return { kind: "tool_result", text: JSON.stringify(await tool.run(ctx, agent.scope, toolArguments)), isError: false };
    } catch (error) {
      return { kind: "tool_result", text: error instanceof Error ? error.message : "The tool failed", isError: true };
    }
  },
});
