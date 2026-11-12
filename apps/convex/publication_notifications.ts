import { v } from "convex/values";
import { publishDeclarationFor, type OnPublishedEffect } from "@opengroow/agent-templates";
import { internal } from "./_generated/api.js";
import type { Doc } from "./_generated/dataModel.js";
import { internalMutation, type MutationCtx } from "./_generated/server.js";
import { indexingOutcomeV } from "./indexing.js";
import { getTemplateRegistry } from "./template_registry.js";

// The `publish.onPublished` call of a Publication (ADR-074, issue #62): made
// once when it is published, recorded on the Publication (`notification`).
// Never blocking: a failure is a warning, the Publication stays published.

/** A `sending` call this old died without recording its outcome: it is shown failed and can be resent. */
export const NOTIFICATION_ABANDONED_AFTER_MS = 5 * 60_000;
const ABANDONED_ERROR = "The call did not finish";

const usesExternalUrl = (effect: OnPublishedEffect) =>
  [effect.path, ...Object.values(effect.body ?? {})].some((value) => value.includes("{publication.externalUrl}"));

/**
 * After `publications.finish`: when the Publication is published and its
 * Mission type declares `publish.onPublished`, marks the call `sending` and
 * schedules it. The mark makes it once per Publication: a replay finds it. A
 * call that sends the post's URL waits for the Publication to have one (a
 * Publisher may report `published` first and the link on a later poll).
 */
export async function scheduleOnPublished(ctx: MutationCtx, publication: Doc<"publications">) {
  if (publication.status !== "published" || publication.notification) return;
  const mission = await ctx.db.get(publication.missionId);
  if (!mission) return;
  const template = await getTemplateRegistry(ctx).resolve(mission.instanceId, mission.templateId);
  const onPublished = publishDeclarationFor(template?.manifest, mission.type)?.onPublished;
  if (!onPublished || (usesExternalUrl(onPublished) && !publication.externalUrl)) return;
  await ctx.db.patch(publication._id, {
    // The user-facing name of the notified service: the Agent's, never the MCP server's.
    notification: { status: "sending", service: template?.manifest.name ?? mission.templateId, updatedAt: Date.now() },
  });
  await ctx.scheduler.runAfter(0, internal.publication_notify_node.notifyPublished, { publicationId: publication._id });
}

const isAbandoned = (notification: Doc<"publications">["notification"], now: number) =>
  notification?.status === "sending" && now - notification.updatedAt > NOTIFICATION_ABANDONED_AFTER_MS;

/** The notification as the Publications list shows it: an abandoned `sending` reads as `failed`. */
export function publicNotificationOf(row: Doc<"publications">, now: number) {
  const notification = row.notification;
  if (!notification) return {};
  const abandoned = isAbandoned(notification, now);
  const error = abandoned ? ABANDONED_ERROR : notification.error;
  return {
    notification: {
      status: abandoned ? ("failed" as const) : notification.status,
      service: notification.service,
      ...(error ? { error } : {}),
    },
  };
}

/**
 * Claims a resend of a failed (or abandoned) onPublished call: only one caller
 * moves it back to `sending`. False = nothing to resend.
 */
export const claimResend = internalMutation({
  args: { publicationId: v.id("publications") },
  handler: async (ctx, args): Promise<boolean> => {
    const publication = await ctx.db.get(args.publicationId);
    const notification = publication?.notification;
    if (publication?.status !== "published" || !notification) return false;
    if (notification.status !== "failed" && !isAbandoned(notification, Date.now())) return false;
    await ctx.db.patch(args.publicationId, {
      notification: { status: "sending", service: notification.service, updatedAt: Date.now() },
    });
    return true;
  },
});

/**
 * Records the outcome of an onPublished call and mirrors its indexing outcome
 * on the Mission (ADR-015). With several Publications, the last answer wins.
 */
export const record = internalMutation({
  args: {
    publicationId: v.id("publications"),
    error: v.optional(v.string()),
    indexing: v.optional(indexingOutcomeV),
  },
  handler: async (ctx, args) => {
    const publication = await ctx.db.get(args.publicationId);
    if (!publication?.notification) return;
    await ctx.db.patch(args.publicationId, {
      notification: {
        status: args.error === undefined ? "sent" : "failed",
        service: publication.notification.service,
        ...(args.error !== undefined ? { error: args.error } : {}),
        updatedAt: Date.now(),
      },
    });
    if (args.indexing) await ctx.db.patch(publication.missionId, { indexing: args.indexing });
  },
});
