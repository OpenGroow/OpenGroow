import { v } from "convex/values";

// Validators shared by the Production Recipe tables and their functions
// (issue #137).

export const recipeStatusV = v.union(v.literal("active"), v.literal("archived"));
