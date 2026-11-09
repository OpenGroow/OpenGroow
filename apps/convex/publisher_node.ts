"use node";

import { v } from "convex/values";
import { publishDeclarationFor } from "@opengroow/agent-templates";
import { internal } from "./_generated/api.js";
import { action, type ActionCtx } from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { loadPlugin } from "./publisher/load_node.js";
import { publishableForService } from "./publishable.js";
import { errorMessage } from "./mission_dispatcher_node.js";
import { getTemplateRegistry, resolveMissionTemplate } from "./template_registry.js";

// Publisher orchestration (ADR-069, docs/domain/publishing.md): sending a
// Mission's Publishable through the Project's Publisher, and the retry of a failed Publication.

const uncertainMessage = (service: string) => `${service} may have received this post; it will be checked before any new attempt`;

/**
 * Sends the Publishable of a Mission to its Publish target(s) through the
 * Project's Publisher. Each Publication is `pending` first, then `published`
 * (or `failed`, leaving the Mission `approved`); the Mission becomes `done`
 * once all its Publications are `published`.
 */
export async function publishThroughPublisher(
  ctx: ActionCtx,
  mission: Doc<"missions">,
  target?: string,
): Promise<void> {
  const prepared = await ctx.runMutation(internal.publications.beginAll, {
    missionId: mission._id,
    ...(target ? { target } : {}),
  });
  // One Publication per target, independent: a failing target does not stop
  // the others, and the action fails at the end so the human can retry it.
  const failures: string[] = [];
  // The Publications already exist: when the package cannot be loaded, record
  // the error on each of them instead of leaving them without a trace.
  let adapter;
  try {
    adapter = await loadPlugin(ctx, prepared.connection.adapter);
  } catch (error) {
    for (const item of prepared.publications) {
      await ctx.runMutation(internal.publications.finish, {
        publicationId: item.publicationId,
        status: "failed",
        error: errorMessage(error),
      });
    }
    throw error;
  }
  const caption = typeof prepared.publishable.caption === "string" ? prepared.publishable.caption : "";
  const emitPublished = async (publicationId: Id<"publications">) => {
    await ctx.runMutation(internal.events.store, {
      instanceId: mission.instanceId,
      event: {
        id: `ReviewPublished:${mission._id}:${publicationId}`,
        type: "ReviewPublished",
        payload: { missionId: mission._id, templateId: mission.templateId, actionKey: "publish" },
        ts: Date.now(),
      },
    });
  };
  for (const item of prepared.publications) {
    // A previous attempt may have reached the service: look for its post first
    // and never send again if it is there (the service has no idempotency key).
    if (item.reconcile) {
      const found = await adapter.findPost(prepared.connection, {
        channelId: item.channelId,
        caption,
        attemptStartedAt: item.reconcile.attemptStartedAt,
        attemptDate: item.reconcile.attemptDate,
      });
      if (!found.ok) {
        await ctx.runMutation(internal.publications.finish, {
          publicationId: item.publicationId,
          status: "uncertain",
          error: `${uncertainMessage(adapter.name)} (could not check: ${found.error})`,
        });
        failures.push(`${item.target}: could not check for an earlier post (${found.error})`);
        continue;
      }
      if (found.post) {
        await ctx.runMutation(internal.publications.finish, {
          publicationId: item.publicationId,
          status: found.post.status,
          externalId: found.post.externalId,
          ...(found.post.status === "scheduled" ? { scheduledAt: item.reconcile.attemptDate } : {}),
          ...(found.post.externalUrl ? { externalUrl: found.post.externalUrl } : {}),
        });
        await emitPublished(item.publicationId);
        continue;
      }
    }
    // The media of this channel's service (ADR-073); none = nothing to send, a clear error.
    const forChannel = publishableForService(prepared.publishable, item.channelService);
    if (!forChannel.ok) {
      await ctx.runMutation(internal.publications.finish, {
        publicationId: item.publicationId,
        status: "failed",
        error: forChannel.error,
        rejected: true,
      });
      failures.push(`${item.target}: ${forChannel.error}`);
      continue;
    }
    let claimed = false;
    const result = await adapter.publish(prepared.connection, {
      channelId: item.channelId,
      ...(item.channelService ? { channelService: item.channelService } : {}),
      settings: item.settings,
      publishable: forChannel.publishable,
      ...(prepared.publishAt !== undefined ? { publishAt: prepared.publishAt } : {}),
      media: item.media,
      beforePost: async (media) => {
        claimed = await ctx.runMutation(internal.publications.markSubmitting, {
          publicationId: item.publicationId,
          media,
          attemptDate: prepared.publishAt ?? Date.now(),
        });
        return claimed;
      },
    });
    if (!result.ok) {
      if (!claimed && result.error === "This Publication is already being sent") {
        failures.push(`${item.target}: ${result.error}`);
        continue;
      }
      await ctx.runMutation(internal.publications.finish, {
        publicationId: item.publicationId,
        status: result.uncertain && claimed ? "uncertain" : "failed",
        error: result.uncertain && claimed ? `${uncertainMessage(adapter.name)} (${result.error})` : result.error,
        ...(!result.uncertain ? { rejected: true } : {}),
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
    await emitPublished(item.publicationId);
  }
  if (failures.length > 0) throw new Error(`Publishing failed: ${failures.join("; ")}`);
}

/**
 * `autoPublish` could not publish: keeps the error on the Mission's
 * Publications (the Mission stays `approved`, retryable). Returns false when
 * no channel was chosen to attach it to, so the caller fails the Mission.
 */
export async function recordAutoPublishFailure(
  ctx: ActionCtx,
  missionId: Id<"missions">,
  err: unknown,
): Promise<boolean> {
  return await ctx.runMutation(internal.publications.recordFailure, {
    missionId,
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
    const { mission } = await ownedPublishingMission(ctx, publication.missionId);
    if (mission.status !== "approved") {
      throw new Error(`A Publication can only be retried while the Mission is approved, got: "${mission.status}"`);
    }
    await publishThroughPublisher(ctx, mission, publication.target);
    return { ok: true };
  },
});
