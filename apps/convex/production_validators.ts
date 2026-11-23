import { v } from "convex/values";

// Validators shared by the Production Recipe tables and their functions
// (issue #137).

export const recipeStatusV = v.union(v.literal("active"), v.literal("archived"));
/** Payload field -> allowed values; empty means any payload. */
export const compatibleWhenV = v.record(v.string(), v.array(v.string()));
