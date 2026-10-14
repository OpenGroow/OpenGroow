import { v } from "convex/values";
import { PINNED_SOURCE_TEMPLATE_ID } from "@opengroow/agent-templates/pinned-source";
import { internalQuery } from "./_generated/server.js";
import { findCurrentVersion } from "./template_registry_store.js";

/**
 * Bootstrap of the official Templates (#673). Official Templates are installed
 * from the hub on demand, except the pinned system Template (Source), which every Project gets
 * when it is created (`source_bootstrap_node.bootstrap`). This file holds the
 * read that action relies on.
 */

/** Whether the Project has a current installed version of the Template. */
export const isInstalled = internalQuery({
  args: { projectId: v.string(), templateId: v.string() },
  handler: async (ctx, { projectId, templateId }): Promise<boolean> =>
    (await findCurrentVersion(ctx, projectId, templateId)) !== undefined,
});
