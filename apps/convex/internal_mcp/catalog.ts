import type { InternalMcpToolName } from "@opengroow/agent-templates";
import { getTemplateRegistry } from "../template_registry.js";
import type { QueryCtx } from "../_generated/server.js";

/**
 * The Internal MCP's tool catalog (ADR-080). One server, many tools: a Template
 * declares the names it may call, and the endpoint serves only those.
 *
 * To add a tool:
 *  1. add its name to `INTERNAL_MCP_TOOL_NAMES` in packages/agent-templates/src/internal-mcp.ts
 *     (Templates may declare it from then on, and the catalog type below then demands its definition);
 *  2. add its entry in `INTERNAL_MCP_CATALOG` here: description, input schema, and a `run`
 *     that reads through `ctx` and is scoped to `scope.instanceId` (the Agent's Project).
 * Tools are read-only: the endpoint always lists them with `readOnlyHint: true`, so the runtime does
 * not ask approval on each call. A tool never takes the Project from its arguments: the scope comes
 * from the authenticated token.
 */
export type InternalMcpScope = { instanceId: string; templateId: string };

export type InternalMcpTool = {
  description: string;
  /** JSON Schema of the arguments (an object schema). */
  inputSchema: Record<string, unknown>;
  run(ctx: QueryCtx, scope: InternalMcpScope, args: Record<string, unknown>): Promise<unknown>;
};

const NO_ARGUMENTS = { type: "object", properties: {}, additionalProperties: false } as const;

async function listMissionTypes(ctx: QueryCtx, scope: InternalMcpScope) {
  const agents = await ctx.db
    .query("projectAgents")
    .withIndex("by_instance_status", (q) => q.eq("instanceId", scope.instanceId).eq("status", "active"))
    .take(100);
  const registry = getTemplateRegistry(ctx);
  const types: { templateId: string; templateName: string; type: string; label: string; description: string }[] = [];
  for (const agent of agents) {
    const template = await registry.resolve(scope.instanceId, agent.templateId);
    if (!template) continue;
    const hidden = new Set(agent.hiddenMissionTypes ?? []);
    for (const missionType of template.manifest.missionTypes ?? []) {
      if (hidden.has(missionType.type)) continue;
      types.push({
        templateId: agent.templateId,
        templateName: template.manifest.name,
        type: missionType.type,
        label: missionType.label,
        description: missionType.description ?? template.manifest.description,
      });
    }
  }
  return types.sort((a, b) => a.templateId.localeCompare(b.templateId) || a.type.localeCompare(b.type));
}

export const INTERNAL_MCP_CATALOG: Record<InternalMcpToolName, InternalMcpTool> = {
  list_mission_types: {
    description:
      "List the Mission types this Project can activate right now: the Mission types of its active Agents, minus the ones the operator hid. Each entry has the Template id, the Mission type, its label and a description of what it produces.",
    inputSchema: NO_ARGUMENTS,
    run: (ctx, scope) => listMissionTypes(ctx, scope),
  },
};

export function catalogTool(name: string): InternalMcpTool | undefined {
  return Object.prototype.hasOwnProperty.call(INTERNAL_MCP_CATALOG, name) ? INTERNAL_MCP_CATALOG[name as InternalMcpToolName] : undefined;
}
