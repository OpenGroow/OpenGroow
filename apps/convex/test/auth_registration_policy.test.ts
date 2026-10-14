import { describe, expect, it, vi } from "vitest";
import { resolveRegistrationPolicy } from "../auth_registration_policy";

describe("resolveRegistrationPolicy (#716 / ADR-059)", () => {
  it("defaults to single-account when the setting is absent", () => {
    expect(resolveRegistrationPolicy(undefined)).toBe("single-account");
    expect(resolveRegistrationPolicy("")).toBe("single-account");
  });

  it("opens multi-account only on the exact explicit value", () => {
    expect(resolveRegistrationPolicy("multi-account")).toBe("unlimited");
    expect(resolveRegistrationPolicy(" multi-account ")).toBe("unlimited");
  });

  it("falls back to single-account on any other (misspelled) value", () => {
    expect(resolveRegistrationPolicy("unlimited")).toBe("single-account");
    expect(resolveRegistrationPolicy("multi")).toBe("single-account");
    expect(resolveRegistrationPolicy("true")).toBe("single-account");
  });

  it("warns loudly on a non-empty value other than multi-account", () => {
    const warn = vi.fn();
    expect(resolveRegistrationPolicy("multi-acount", warn)).toBe("single-account");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("OPENGROOW_ACCOUNT_MODE");
    expect(warn.mock.calls[0][0]).toContain("multi-acount");
  });

  it("stays silent for unset, empty and valid values", () => {
    const warn = vi.fn();
    resolveRegistrationPolicy(undefined, warn);
    resolveRegistrationPolicy("  ", warn);
    resolveRegistrationPolicy("multi-account", warn);
    expect(warn).not.toHaveBeenCalled();
  });
});
