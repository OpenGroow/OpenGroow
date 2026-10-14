import { describe, it, expect } from "vitest";
import { decideBoundedRetry, isRetryDecision, isTerminalDecision } from "./index.js";

describe("decideBoundedRetry", () => {
  it("allows a retry when the bound has not been reached yet, and reports attempts remaining", () => {
    const decision = decideBoundedRetry({ attempts: 0 }, { maxAttempts: 3 });
    expect(decision).toEqual({
      retry: true,
      nextState: { attempts: 1 },
      attemptsRemaining: 2,
    });
  });

  it("allows the last retry exactly at the bound, reporting zero attempts remaining", () => {
    const decision = decideBoundedRetry({ attempts: 2 }, { maxAttempts: 3 });
    expect(decision).toEqual({
      retry: true,
      nextState: { attempts: 3 },
      attemptsRemaining: 0,
    });
  });

  it("returns a terminal decision once the bound is exceeded", () => {
    const decision = decideBoundedRetry({ attempts: 3 }, { maxAttempts: 3 });
    expect(decision).toEqual({
      terminal: true,
      reason: "bound_exceeded",
      attemptsUsed: 3,
    });
  });

  it("treats a zero-attempt bound as immediately exhausted", () => {
    const decision = decideBoundedRetry({ attempts: 0 }, { maxAttempts: 0 });
    expect(decision).toEqual({
      terminal: true,
      reason: "bound_exceeded",
      attemptsUsed: 0,
    });
  });

  it("narrows retry vs. terminal decisions via the isRetryDecision/isTerminalDecision guards", () => {
    const retry = decideBoundedRetry({ attempts: 0 }, { maxAttempts: 1 });
    const terminal = decideBoundedRetry({ attempts: 1 }, { maxAttempts: 1 });

    expect(isRetryDecision(retry)).toBe(true);
    expect(isTerminalDecision(retry)).toBe(false);
    expect(isRetryDecision(terminal)).toBe(false);
    expect(isTerminalDecision(terminal)).toBe(true);
  });
});
