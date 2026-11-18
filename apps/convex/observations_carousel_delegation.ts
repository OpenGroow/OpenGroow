import { v } from "convex/values";
import { internalQuery } from "./_generated/server.js";
import type { CarouselPlanningSourceInfo } from "./mission_dispatcher/context_providers.js";
import { declaredPlatformOf, originKeyPrefixOf } from "./source_platform.js";
import { creativeFeaturesOf, deepAnalysisOf, stringOf } from "./sources_social.js";

/**
 * Agent-facing Source context for production Missions. The retired routing
 * Mission and delegate mutations were removed in #601; production Missions
 * are now created directly by the generic source_routing Job.
 */
export const getCarouselPlanningContext = internalQuery({
  args: { observationId: v.id("sources"), instanceId: v.string() },
  handler: async (ctx, args): Promise<CarouselPlanningSourceInfo> => {
    const source = await ctx.db.get(args.observationId);
    if (!source || source.instanceId !== args.instanceId) return null;
    // The platform is what the Source's Template declares (ADR-077).
    const declared = await declaredPlatformOf(ctx, source);
    const platform = declared ? originKeyPrefixOf(declared) : undefined;
    const features = creativeFeaturesOf(source);
    const mediaType = features?.mediaType;
    if (!platform || (mediaType !== "carousel" && mediaType !== "video")) return null;
    if (!features) return null;

    return {
      platform,
      mediaType,
      format: typeof features.format === "string" ? features.format : undefined,
      mediaStructure: typeof features.mediaStructure === "string" ? features.mediaStructure : undefined,
      creativeMechanic: stringOf(source, "creativeMechanic"),
      reproducibleElements: source.marketing.reproducibleElements,
      topicSpecificElements: source.marketing.topicSpecificElements,
      analysis: deepAnalysisOf(source),
      ...(mediaType === "carousel"
        ? { producesCarousel: true as const }
        : {}),
    };
  },
});
