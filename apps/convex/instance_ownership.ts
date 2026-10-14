import type { ActionCtx, QueryCtx } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { ownerOfInstance } from "./projects.js";

// Instance-ownership / identity-resolution primitives shared by the resource
// modules (missions, schedules, …). All ownership checks validate against the
// `instances` table so the rule for "who owns this instance" lives in one place.

async function requireIdentity(ctx: QueryCtx | ActionCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Authentication required");
  }
  return identity;
}

/** True when `ownerId` is unset (unowned instance) or matches the caller's identity. */
function isOwnerMatch(
  ownerId: string | undefined,
  identity: { subject: string; tokenIdentifier: string },
): boolean {
  return !ownerId || ownerId === identity.subject || ownerId === identity.tokenIdentifier;
}

/** Resolves the caller's owner id for `instanceId`, throwing `Forbidden` if the
 * instance is missing or the caller does not own it. */
export async function ownerIdFor(ctx: QueryCtx, instanceId: string): Promise<string> {
  const identity = await requireIdentity(ctx);
  const matches = await ctx.db
    .query("instances")
    .withIndex("by_openclaw_id", (q) => q.eq("openclawId", instanceId))
    .collect();
  if (matches.length !== 1 || !isOwnerMatch(await ownerOfInstance(ctx, matches[0]), identity)) {
    throw new Error("Forbidden");
  }
  return identity.subject ?? identity.tokenIdentifier;
}

/** Like {@link ownerIdFor} but returns `null` (instead of throwing) when the
 * instance is missing or unowned. Still throws when unauthenticated. */
export async function readOwnerId(ctx: QueryCtx, instanceId: string): Promise<string | null> {
  const identity = await requireIdentity(ctx);
  const matches = await ctx.db
    .query("instances")
    .withIndex("by_openclaw_id", (q) => q.eq("openclawId", instanceId))
    .collect();
  if (matches.length !== 1 || !isOwnerMatch(await ownerOfInstance(ctx, matches[0]), identity)) {
    return null;
  }
  return identity.subject ?? identity.tokenIdentifier;
}

/** All owner identifiers accepted for rows belonging to an owned Instance.
 * Better Auth can persist `tokenIdentifier` while requests expose `subject`,
 * and older rows may use either representation. */
export async function ownerIdsFor(ctx: QueryCtx, instanceId: string): Promise<ReadonlySet<string> | null> {
  const identity = await requireIdentity(ctx);
  const matches = await ctx.db
    .query("instances")
    .withIndex("by_openclaw_id", (q) => q.eq("openclawId", instanceId))
    .collect();
  const instance = matches[0];
  if (matches.length !== 1 || !instance) return null;
  const ownerId = await ownerOfInstance(ctx, instance);
  if (!isOwnerMatch(ownerId, identity)) return null;
  return new Set([identity.subject, identity.tokenIdentifier, ownerId].filter((value): value is string => Boolean(value)));
}

/** Throws `Forbidden` unless the caller owns `row`'s Instance and `row` itself
 * belongs to that same owner — the "load a row, then check it's mine" shape
 * shared by every mutation that lets a founder act on one row they don't
 * otherwise reach through an index (e.g. `observations.remove`),
 * factored out so that shape lives in the one module
 * that already owns "who owns this instance." */
export async function requireOwnedRow(
  ctx: QueryCtx,
  row: { instanceId: string; ownerId: string },
): Promise<void> {
  const ownerIds = await ownerIdsFor(ctx, row.instanceId);
  if (!ownerIds || !ownerIds.has(row.ownerId)) throw new Error("Forbidden");
}

/** Action-context equivalent of {@link ownerIdFor}: actions cannot use `ctx.db`
 * directly, so ownership is resolved via an internal query instead. */
export async function requireOwnerOfInstance(ctx: ActionCtx, instanceId: string): Promise<void> {
  const identity = await requireIdentity(ctx);
  const instance = await ctx.runQuery(internal.instances.getUniqueByOpenclawId, { openclawId: instanceId });
  if (!instance || !isOwnerMatch(instance.ownerId, identity)) {
    throw new Error("Forbidden");
  }
}
