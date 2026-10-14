import { describe, expect, it } from "vitest";
import { scopeReservationProblem } from "./scope-reservation";

const pkg = (id: string, extra: { category?: string; jobTypes?: { type: string }[] } = {}) => ({
  id,
  category: "marketing",
  ...extra,
});

describe("scopeReservationProblem (the @opengroow scope is reserved to the official hub)", () => {
  it("accepts an official package from the hub, even a system one with reserved Job types", () => {
    expect(
      scopeReservationProblem(pkg("@opengroow/source", { category: "system", jobTypes: [{ type: "source_ingestion" }] }), "hub"),
    ).toBeUndefined();
  });

  it("accepts a community package with ordinary content from any origin", () => {
    for (const origin of ["local_folder", "linked_folder", "git", "hub"] as const) {
      expect(scopeReservationProblem(pkg("@alice/seo"), origin)).toBeUndefined();
    }
  });

  it.each(["local_folder", "linked_folder", "git"] as const)("refuses a package of the former official scope from the %s origin", (origin) => {
    expect(scopeReservationProblem(pkg("@opengroow/seo"), origin)).toMatch(/@opengroow.*reserved.*official hub/);
  });

  it("refuses a non-@opengroow package declaring category system", () => {
    expect(scopeReservationProblem(pkg("@alice/source", { category: "system" }), "hub")).toMatch(
      /@alice\/source.*only the @opengroow scope.*category "system"/,
    );
  });

  it.each(["source_ingestion", "source_scoring", "source_routing"])(
    "refuses a non-@opengroow package declaring the reserved Job type %s",
    (type) => {
      expect(scopeReservationProblem(pkg("@alice/x", { jobTypes: [{ type }] }), "git")).toMatch(
        new RegExp(`"${type}".*reserved.*@opengroow`),
      );
    },
  );

  it("does not take a lookalike scope for @opengroow", () => {
    expect(scopeReservationProblem(pkg("@opengroow-evil/seo"), "local_folder")).toBeUndefined();
    expect(scopeReservationProblem(pkg("@opengroow-evil/s", { category: "system" }), "hub")).toMatch(/system/);
  });
});
