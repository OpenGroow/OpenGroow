import type { ActionCtx } from "../_generated/server.js";
import { getUniqueInstanceByOpenclawIdQuery } from "./shared_refs.js";

export type AuthenticatedUser = {
  tokenIdentifier: string;
  subject: string;
};

export async function requireAuthenticatedUser(ctx: ActionCtx): Promise<AuthenticatedUser> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Authentication required");
  }
  return {
    tokenIdentifier: identity.tokenIdentifier,
    subject: identity.subject,
  };
}

export async function requireInstanceOwner(
  ctx: ActionCtx,
  instanceId: string,
  user: AuthenticatedUser,
): Promise<{ ok: true } | { ok: false; errorMessage: string }> {
  const instance = await ctx.runQuery(getUniqueInstanceByOpenclawIdQuery, {
    openclawId: instanceId,
  });

  if (!instance) {
    return { ok: false, errorMessage: "Forbidden" };
  }
  if (!instance.ownerId) {
    return { ok: true };
  }
  if (instance.ownerId !== user.tokenIdentifier && instance.ownerId !== user.subject) {
    return { ok: false, errorMessage: "Forbidden" };
  }
  return { ok: true };
}
