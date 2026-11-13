import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { ownerOfInstance } from "./projects.js";

const ARTICLE_MARKDOWN_TIMEOUT_MS = 15_000;
const ARTICLE_MARKDOWN_MAX_BYTES = 2_000_000;

/** Resolve the URL and authorize its read in the same transaction (ADR-074). */
export const markdownUrlForOwner = internalQuery({
  args: { missionId: v.id("missions") },
  returns: v.string(),
  handler: async (ctx, { missionId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");
    const mission = await ctx.db.get(missionId);
    if (!mission) throw new Error("Mission not found");

    if (mission.ownerId !== identity.tokenIdentifier) {
      // Historical Missions store a bare subject. It is only an attribution,
      // not sufficient authorization: bind it to the Project's full identity.
      const instance = await ctx.db
        .query("instances")
        .withIndex("by_openclaw_id", (q) => q.eq("openclawId", mission.instanceId))
        .unique();
      if (
        mission.ownerId !== identity.subject ||
        !instance ||
        (await ownerOfInstance(ctx, instance)) !== identity.tokenIdentifier
      ) {
        throw new Error("Forbidden");
      }
    }

    const resultArtifact = mission.lastResult && "artifact" in mission.lastResult ? mission.lastResult.artifact : undefined;
    const publishable = (mission.lastArtifact ?? resultArtifact)?.publishable;
    if (publishable?.kind !== "article") throw new Error("This Mission's Publishable is not an article");
    return publishable.markdownUrl;
  },
});

/** Read the public article Markdown without a key, as the Publisher does (ADR-074). */
export const loadMarkdown = action({
  args: { missionId: v.id("missions") },
  returns: v.object({ content: v.string() }),
  handler: async (ctx, args): Promise<{ content: string }> => {
    const markdownUrl: string = await ctx.runQuery(internal.mission_articles.markdownUrlForOwner, args);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ARTICLE_MARKDOWN_TIMEOUT_MS);
    try {
      const response = await fetch(markdownUrl, { signal: controller.signal });
      if (!response.ok) throw new Error(`The article markdown could not be read: HTTP ${response.status}`);
      const content = await response.text();
      if (content.length > ARTICLE_MARKDOWN_MAX_BYTES) throw new Error("The article markdown is too large to review");
      return { content };
    } finally {
      clearTimeout(timeout);
    }
  },
});
