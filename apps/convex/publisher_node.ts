"use node";

import { v } from "convex/values";
import { publishDeclarationFor, type PublishDeclaration } from "@opengroow/agent-templates";
import { internal } from "./_generated/api.js";
import { action, type ActionCtx } from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { adapterFor } from "./publisher/postiz.js";
import { errorMessage } from "./mission_dispatcher_node.js";
import { getTemplateRegistry, resolveMissionTemplate } from "./template_registry.js";

// Publisher orchestration (ADR-069, docs/domain/publishing.md): sending a
// Mission's Publishable through the Project's Publisher, the human's edits of
// its Publish targets, and the retry of a failed Publication.

/**
 * Sends the Publishable of a Mission to its Publish target(s) through the
 * Project's Publisher. Each Publication is `pending` first, then `published`
 * (or `failed`, leaving the Mission `approved`); the Mission becomes `done`
 * once all its Publications are `published`.
 */
export async function publishThroughPublisher(
  ctx: ActionCtx,
  mission: Doc<"missions">,
  declaredTargets: string[],
  target?: string,
): Promise<void> {
  const prepared = await ctx.runMutation(internal.publications.beginAll, {
    missionId: mission._id,
    declaredTargets,
    ...(target ? { target } : {}),
  });
  // One Publication per target, independent: a failing target does not stop
  // the others, and the action fails at the end so the human can retry it.
  const failures: string[] = [];
  for (const item of prepared.publications) {
    const result = await adapterFor(prepared.connection.adapter).publish(prepared.connection, {
      channelId: item.channelId,
      ...(item.channelService ? { channelService: item.channelService } : {}),
      settings: item.settings,
      publishable: prepared.publishable,
      ...(prepared.publishAt !== undefined ? { publishAt: prepared.publishAt } : {}),
    });
    if (!result.ok) {
      await ctx.runMutation(internal.publications.finish, {
        publicationId: item.publicationId,
        status: "failed",
        error: result.error,
      });
      failures.push(`${item.target}: ${result.error}`);
      continue;
    }
    await ctx.runMutation(internal.publications.finish, {
      publicationId: item.publicationId,
      status: result.outcome.status,
      externalId: result.outcome.externalId,
      ...(result.outcome.status === "scheduled" && prepared.publishAt !== undefined ? { scheduledAt: prepared.publishAt } : {}),
      ...(result.outcome.externalUrl ? { externalUrl: result.outcome.externalUrl } : {}),
    });
    await ctx.runMutation(internal.events.store, {
      instanceId: mission.instanceId,
      event: {
        id: `ReviewPublished:${mission._id}:${item.publicationId}`,
        type: "ReviewPublished",
        payload: { missionId: mission._id, templateId: mission.templateId, actionKey: "publish" },
        ts: Date.now(),
      },
    });
  }
  if (failures.length > 0) throw new Error(`Publishing failed: ${failures.join("; ")}`);
}

/**
 * `autoPublish` could not publish: keeps the error on the Mission's
 * Publications (the Mission stays `approved`, retryable). Returns false when
 * there is no Publish target to attach it to, so the caller fails the Mission.
 */
export async function recordAutoPublishFailure(
  ctx: ActionCtx,
  missionId: Id<"missions">,
  declaration: PublishDeclaration,
  err: unknown,
): Promise<boolean> {
  return await ctx.runMutation(internal.publications.recordFailure, {
    missionId,
    declaredTargets: declaration.targets,
    error: errorMessage(err),
  });
}

/** The caller's Mission, with the `publish` declaration of its type. Throws for anyone else. */
async function ownedPublishingMission(ctx: ActionCtx, missionId: Id<"missions">) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authentication required");
  const mission = await ctx.runQuery(internal.missions.getByIdInternal, { missionId });
  if (!mission) throw new Error("Mission not found");
  if (mission.ownerId !== (identity.subject ?? identity.tokenIdentifier)) throw new Error("Forbidden");
  const template = await resolveMissionTemplate(getTemplateRegistry(ctx), mission);
  if (!template) throw new Error(`Template not found: ${mission.templateId}`);
  const declaration = publishDeclarationFor(template.manifest, mission.type);
  if (!declaration) throw new Error("This Mission type does not publish");
  return { mission, declaration };
}

/** The human sends a Mission to one or several targets during review (one Publication each). */
export const setPublishTargets = action({
  args: { missionId: v.id("missions"), targets: v.array(v.string()) },
  handler: async (ctx, args): Promise<void> => {
    const { declaration } = await ownedPublishingMission(ctx, args.missionId);
    await ctx.runMutation(internal.publications.storeTargets, {
      missionId: args.missionId,
      targets: args.targets,
      declaredTargets: declaration.targets,
    });
  },
});

/**
 * Retries one `failed` Publication on its own (issue #20): the other
 * Publications of the Mission are untouched; the Mission becomes `done` once
 * all of them are `published`. Only while the Mission is `approved`.
 */
export const retryPublication = action({
  args: { publicationId: v.id("publications") },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const publication: Doc<"publications"> | null = await ctx.runQuery(internal.publications.getInternal, {
      publicationId: args.publicationId,
    });
    if (!publication) throw new Error("Publication not found");
    const { mission, declaration } = await ownedPublishingMission(ctx, publication.missionId);
    if (mission.status !== "approved") {
      throw new Error(`A Publication can only be retried while the Mission is approved, got: "${mission.status}"`);
    }
    await publishThroughPublisher(ctx, mission, declaration.targets, publication.target);
    return { ok: true };
  },
});
