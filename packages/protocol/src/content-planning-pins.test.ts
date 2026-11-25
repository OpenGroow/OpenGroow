import { describe, expect, it } from "vitest";
import { planningPeriodOf, remainingOf } from "./content-planning-pins";

describe("planningPeriodOf", () => {
  it("starts the day after the Run and lasts planningDays inclusive days, in UTC", () => {
    expect(planningPeriodOf(Date.UTC(2030, 2, 4, 10, 0), 7)).toEqual({ periodStart: "2030-03-05", periodEnd: "2030-03-11" });
  });
  it("is a single day for a 1-day horizon", () => {
    expect(planningPeriodOf(Date.UTC(2030, 2, 4, 23, 59), 1)).toEqual({ periodStart: "2030-03-05", periodEnd: "2030-03-05" });
  });
  it("crosses month and year ends", () => {
    expect(planningPeriodOf(Date.UTC(2030, 11, 30, 6, 0), 3)).toEqual({ periodStart: "2030-12-31", periodEnd: "2031-01-02" });
  });
});

describe("remainingOf", () => {
  it.each([[5, 2, 3], [5, 5, 0], [5, 9, 0], [5, 0, 5]])("target %i with %i existing leaves %i", (target, existing, remaining) => {
    expect(remainingOf(target, existing)).toBe(remaining);
  });
});
