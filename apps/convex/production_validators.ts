import { v } from "convex/values";

// Validators shared by the Production Recipe tables and their functions
// (issue #137).

export const recipeStatusV = v.union(v.literal("active"), v.literal("archived"));
export const connectionStatusV = v.union(v.literal("candidate"), v.literal("active"), v.literal("disabled"));
/** Payload field -> allowed values; empty means any payload. */
export const compatibleWhenV = v.record(v.string(), v.array(v.string()));
