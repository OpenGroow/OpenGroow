import type { Doc, Id } from "./_generated/dataModel.js";
import type { MutationCtx, QueryCtx } from "./_generated/server.js";

// The Project as its own entity (#724, ADR-066). Helpers shared by the Instance
// write paths, so the rules live in one place. The Project carries the owner
// and the display name; the Instance only links to it.

/** Creates a Project row. Its `_id` is the stable identity from this moment on. */
export async function insertProject(
  ctx: MutationCtx,
  fields: { projectId?: string; ownerId?: string; displayName?: string },
): Promise<Id<"projects">> {
  const now = Date.now();
  return await ctx.db.insert("projects", { ...fields, createdAt: now, updatedAt: now });
}

/** The Project an Instance runs. */
export async function projectOfInstance(
  ctx: QueryCtx,
  instance: Pick<Doc<"instances">, "projectId">,
): Promise<Doc<"projects"> | null> {
  return await ctx.db.get(instance.projectId);
}

/** Owner of an Instance: its Project's. Undefined for an unowned Project. */
export async function ownerOfInstance(
  ctx: QueryCtx,
  instance: Pick<Doc<"instances">, "projectId">,
): Promise<string | undefined> {
  return (await projectOfInstance(ctx, instance))?.ownerId;
}

/** An Instance row with the owner of its Project, for callers that cannot read the database (actions). */
export async function withOwner<T extends Pick<Doc<"instances">, "projectId">>(
  ctx: QueryCtx,
  instance: T,
): Promise<T & { ownerId?: string }> {
  return { ...instance, ownerId: await ownerOfInstance(ctx, instance) };
}

/** The one place a Project is renamed. */
export async function setProjectDisplayName(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  displayName: string,
): Promise<void> {
  await ctx.db.patch(projectId, { displayName, updatedAt: Date.now() });
}
