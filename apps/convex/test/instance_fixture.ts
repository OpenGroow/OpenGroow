import type { MutationCtx } from "../_generated/server";
import type { WithoutSystemFields } from "convex/server";
import type { Doc } from "../_generated/dataModel";

type InstanceFields = Omit<WithoutSystemFields<Doc<"instances">>, "projectId" | "userId" | "displayName"> & {
  /** Becomes `projects.ownerId`. */
  userId?: string;
  /** Becomes `projects.displayName`. */
  displayName?: string;
};

/** Inserts an Instance together with its Project (ADR-066): `projectId` is required on `instances`. */
export async function insertInstance(ctx: Pick<MutationCtx, "db">, fields: InstanceFields) {
  const { userId, displayName, ...instance } = fields;
  const now = Date.now();
  const projectId = await ctx.db.insert("projects", {
    projectId: instance.openclawId,
    ownerId: userId,
    displayName,
    createdAt: now,
    updatedAt: now,
  });
  return await ctx.db.insert("instances", { ...instance, projectId });
}
