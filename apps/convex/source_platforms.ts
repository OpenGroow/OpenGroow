import { v } from "convex/values";
import { query } from "./_generated/server.js";
import { readOwnerId } from "./instance_ownership.js";
import { getTemplateRegistry } from "./template_registry.js";

/**
 * The platform each Source type of the Instance's Agents declares (ADR-077):
 * what the dashboard shows next to a Source (its logo, and the words for its
 * media). One row per declared platform, not per Source, so a page of Sources
 * does not carry a logo each. Empty for someone who does not own the Instance.
 */
export const forInstance = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    if ((await readOwnerId(ctx, args.instanceId)) === null) return [];
    const agents = await ctx.db
      .query("projectAgents")
      .withIndex("by_instance_template", (q) => q.eq("instanceId", args.instanceId))
      .collect();
    const registry = getTemplateRegistry(ctx);
    const rows = [];
    for (const templateId of new Set(agents.map((agent) => agent.templateId))) {
      const template = await registry.resolve(args.instanceId, templateId);
      for (const source of template?.manifest.sources ?? []) {
        const { platform } = source;
        if (!platform) continue;
        rows.push({
          templateId,
          sourceId: source.type,
          name: platform.name,
          ...(platform.icon ? { icon: platform.icon } : {}),
          ...(platform.mediaLabels ? { mediaLabels: platform.mediaLabels } : {}),
        });
      }
    }
    return rows;
  },
});
