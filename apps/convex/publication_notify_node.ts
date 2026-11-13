"use node";

import { v } from "convex/values";
import { interpolateOnPublishedTemplate, publishDeclarationFor } from "@opengroow/agent-templates";
import { internal } from "./_generated/api.js";
import { action, internalAction, type ActionCtx } from "./_generated/server.js";
import type { Doc } from "./_generated/dataModel.js";
import { callBoundedHttpEffect } from "./bounded_http_call.js";
import { errorMessage } from "./mission_dispatcher_node.js";
import { getTemplateRegistry, resolveMissionTemplate } from "./template_registry.js";

// `publish.onPublished` (ADR-074, issue #62): once a Publication is published,
// the service that produced the deliverable is told, so it can follow up (its
// own status, indexing mirrored on the Mission per ADR-015). Never blocking:
// the outcome is only recorded on the Publication (a warning when it failed).

/** Calls the Mission type's onPublished effect for one Publication; the error message, if it failed. */
async function callOnPublished(ctx: ActionCtx, publication: Doc<"publications">, startedAt: number): Promise<string | undefined> {
  try {
    const mission: Doc<"missions"> | null = await ctx.runQuery(internal.missions.getByIdInternal, {
      missionId: publication.missionId,
    });
    if (!mission) throw new Error("Mission not found");
    const template = await resolveMissionTemplate(getTemplateRegistry(ctx), mission);
    if (!template) throw new Error(`Template not found: ${mission.templateId}`);
    const effect = publishDeclarationFor(template.manifest, mission.type)?.onPublished;
    if (!effect) throw new Error("The Agent no longer asks to be told when its content is published");

    const lastResult = mission.lastResult;
    const externalId = lastResult && "artifact" in lastResult ? lastResult.artifact?.external?.id : undefined;
    const values = {
      id: typeof externalId === "string" ? externalId : "",
      externalUrl: publication.externalUrl,
      externalId: publication.externalId,
    };
    const usesId = effect.path.includes("{id}") || Object.values(effect.body ?? {}).some((value) => value.includes("{id}"));
    if (usesId && !values.id) throw new Error("The Mission has no reference at its Agent to send");

    let body: Record<string, string> | undefined;
    if (effect.body) {
      body = {};
      for (const [key, template] of Object.entries(effect.body)) {
        const value = interpolateOnPublishedTemplate(template, values, false);
        // A placeholder the Publication has no value for is left out, as review effects do.
        if (value !== "") body[key] = value;
      }
    }
    const indexing = await callBoundedHttpEffect(ctx, {
      mission,
      template,
      server: effect.server,
      method: effect.method,
      path: interpolateOnPublishedTemplate(effect.path, values, true),
      ...(body !== undefined ? { body } : {}),
      ...(effect.responseIndexingField ? { responseIndexingField: effect.responseIndexingField } : {}),
      label: "The call",
    });
    await ctx.runMutation(internal.publication_notifications.record, {
      publicationId: publication._id,
      startedAt,
      ...(indexing ? { indexing } : {}),
    });
    return undefined;
  } catch (error) {
    const message = errorMessage(error);
    await ctx.runMutation(internal.publication_notifications.record, { publicationId: publication._id, startedAt, error: message });
    return message;
  }
}

/** Scheduled by `publications.finish` when a Publication becomes published. */
export const notifyPublished = internalAction({
  args: { publicationId: v.id("publications") },
  handler: async (ctx, args): Promise<void> => {
    const publication: Doc<"publications"> | null = await ctx.runQuery(internal.publications.getInternal, {
      publicationId: args.publicationId,
    });
    if (publication?.notification?.status !== "sending") return;
    const error = await callOnPublished(ctx, publication, publication.notification.updatedAt);
    if (error) console.warn(`onPublished for Publication ${args.publicationId} failed: ${error}`);
  },
});

/**
 * The review's "resend" button: calls a failed onPublished effect again. The
 * receiving endpoint is expected to be idempotent (ADR-074).
 */
export const resendPublishedNotification = action({
  args: { publicationId: v.id("publications") },
  handler: async (ctx, args): Promise<{ ok: true } | { ok: false; error: string }> => {
    const claimed = await ctx.runMutation(internal.publication_notifications.claimResend, args);
    if (!claimed) throw new Error("This call is already being sent, or it went through");
    const publication: Doc<"publications"> | null = await ctx.runQuery(internal.publications.getInternal, args);
    if (!publication?.notification) throw new Error("Publication notification not found");
    // A failed call is recorded on the Publication (its warning shows the error), not thrown.
    const error = await callOnPublished(ctx, publication, publication.notification.updatedAt);
    return error === undefined ? { ok: true } : { ok: false, error };
  },
});
