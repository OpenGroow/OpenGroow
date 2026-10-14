import { ConvexError } from "convex/values";

/** The message to show for a caught error; a `ConvexError` carries it in its string `data`. */
export function messageOf(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === "string") return error.data;
  return error instanceof Error ? error.message : String(error);
}
