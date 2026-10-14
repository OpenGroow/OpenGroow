import { describe, expect, it } from "vitest";
import { extractConvexErrorMessage } from "../src/lib/convex-error";

describe("extractConvexErrorMessage", () => {
  it("extracts the thrown message from a wrapped Convex server error", () => {
    const raw =
      "[CONVEX M(missions:deleteMission)] [Request ID: abc123] Server Error\n" +
      "Uncaught Error: Cannot delete a mission while its run is in flight on the Project\n" +
      "    at handler (../convex/missions.ts:200:13)";
    expect(extractConvexErrorMessage(new Error(raw), "fallback")).toBe(
      "Cannot delete a mission while its run is in flight on the Project",
    );
  });

  it("handles ConvexError-prefixed messages", () => {
    const raw =
      "[CONVEX M(x:y)] Server Error\nUncaught ConvexError: Forbidden\n    at handler";
    expect(extractConvexErrorMessage(new Error(raw), "fallback")).toBe("Forbidden");
  });

  it("returns a clean single-line message untouched", () => {
    expect(extractConvexErrorMessage(new Error("Plain message"), "fallback")).toBe(
      "Plain message",
    );
  });

  it("falls back when the value is not an Error", () => {
    expect(extractConvexErrorMessage("oops", "fallback")).toBe("fallback");
    expect(extractConvexErrorMessage(undefined, "fallback")).toBe("fallback");
  });
})
