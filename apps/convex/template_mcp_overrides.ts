import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalQuery, mutation, query, type MutationCtx } from "./_generated/server.js";
import { env } from "./env.js";
import { readableProjectId } from "./project_templates.js";
import { getTemplateRegistry } from "./template_registry.js";
import { listMcpUrlOverrides, type RegistryDbCtx } from "./template_registry_store.js";

/**
 * Self-host MCP URL override per installed Template (#654). Packages carry
 * production MCP URLs only; on a self-hosted deployment the operator points
 * each MCP server at their own instance. The override is read back through
 * the registry (`getTemplateRegistry`), which derives the runtime, Convex and
 * public views from it. The setting does not exist on the hosted deployment.
 */

const key = { projectId: v.string(), templateId: v.string(), serverName: v.string() };

function assertSelfHost(): void {
  if (!env.IS_SELF_HOST) throw new ConvexError("MCP URL overrides are only available on self-hosted deployments");
}

function assertHttpUrl(url: string): void {
  let protocol: string | undefined;
  try {
    protocol = new URL(url).protocol;
  } catch {
    // reported below
  }
  if (protocol !== "http:" && protocol !== "https:") {
    throw new ConvexError("The MCP URL must be an absolute http(s) URL");
  }
}

/** The overrides of a Template's MCP servers: always empty on the hosted deployment. */
export const listForTemplate = query({
  args: { projectId: v.string(), templateId: v.string() },
  handler: async (ctx, { projectId, templateId }) => {
    if (!env.IS_SELF_HOST) return [];
    const readable = await readableProjectId(ctx, projectId);
    if (!readable) return [];
    const overrides = await listMcpUrlOverrides(ctx, readable, templateId);
    return Object.entries(overrides).map(([serverName, url]) => ({ serverName, url }));
  },
});

export const set = mutation({
  args: { ...key, url: v.string() },
  handler: async (ctx, { projectId, templateId, serverName, url }) => {
    assertSelfHost();
    const readable = await readableProjectId(ctx, projectId);
    if (!readable) throw new ConvexError("Project not found or not accessible");
    const trimmed = url.trim();
    assertHttpUrl(trimmed);
    const template = await getTemplateRegistry(ctx).resolve(readable, templateId);
    if (!template?.manifest.mcpServers.some((server) => server.name === serverName)) {
      throw new ConvexError(`Template "${templateId}" declares no MCP server "${serverName}"`);
    }
    const existing = await findOverride(ctx, readable, templateId, serverName);
    if (existing) await ctx.db.patch(existing._id, { url: trimmed });
    else await ctx.db.insert("templateMcpUrlOverrides", { projectId: readable, templateId, serverName, url: trimmed });
    await pushToRunningAgent(ctx, readable, templateId);
  },
});

/** Back to the URL the package declares. */
export const clear = mutation({
  args: key,
  handler: async (ctx, { projectId, templateId, serverName }) => {
    assertSelfHost();
    const readable = await readableProjectId(ctx, projectId);
    if (!readable) throw new ConvexError("Project not found or not accessible");
    const existing = await findOverride(ctx, readable, templateId, serverName);
    if (!existing) return;
    await ctx.db.delete(existing._id);
    await pushToRunningAgent(ctx, readable, templateId);
  },
});

/** Internal read for the actions' registry (`getTemplateRegistry`): they have no database, only `runQuery`. */
export const forTemplate = internalQuery({
  args: { projectId: v.string(), templateId: v.string() },
  handler: async (ctx, { projectId, templateId }) => listMcpUrlOverrides(ctx, projectId, templateId),
});

/**
 * A running Agent carries the MCP URLs in its runtime config (`openclaw.json`),
 * which a refresh does not rewrite: push the servers as now resolved.
 */
async function pushToRunningAgent(ctx: MutationCtx, projectId: string, templateId: string): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.project_agents_node.pushMcpServers, { instanceId: projectId, templateId });
}

async function findOverride(
  ctx: RegistryDbCtx,
  projectId: string,
  templateId: string,
  serverName: string,
) {
  return await ctx.db
    .query("templateMcpUrlOverrides")
    .withIndex("by_project_template", (q) =>
      q.eq("projectId", projectId).eq("templateId", templateId).eq("serverName", serverName),
    )
    .unique();
}
