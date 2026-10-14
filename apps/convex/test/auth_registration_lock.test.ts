import { describe, expect, it } from "vitest";
import { shouldAllowSignUp } from "../auth_registration_lock";

describe("shouldAllowSignUp (issue #263 / ADR-029)", () => {
  it("allows sign-up when no account exists yet", () => {
    expect(shouldAllowSignUp(0)).toBe(true);
  });

  it("rejects sign-up once at least one account exists", () => {
    expect(shouldAllowSignUp(1)).toBe(false);
    expect(shouldAllowSignUp(2)).toBe(false);
  });
});
