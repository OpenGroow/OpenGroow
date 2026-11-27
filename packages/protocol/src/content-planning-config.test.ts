import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLANNING_DAYS,
  planningDaysOf,
  productionTargetsOf,
  usableTargets,
  validateContentPlanningConfig,
} from "./content-planning-config";

const options = { formats: ["video", "image"], publishTargets: ["social:example", "blog:example"] };
const target = (overrides: Record<string, unknown> = {}) => ({ contentType: "video", quantity: 3, publishTargets: ["social:example"], ...overrides });
const config = (overrides: Record<string, unknown> = {}) => ({ planningDays: 7, productionTargets: [target()], ...overrides });

describe("validateContentPlanningConfig", () => {
  it("accepts the default configuration (no target)", () => {
    expect(validateContentPlanningConfig({ planningDays: 7, productionTargets: [] }, options)).toEqual({
      ok: true,
      value: { planningDays: 7, productionTargets: [] },
    });
  });

  it("accepts a valid configuration and returns it normalized", () => {
    const result = validateContentPlanningConfig(config({ productionTargets: [target({ publishTargets: ["social:example", "social:example"] })] }), options);
    expect(result).toEqual({ ok: true, value: { planningDays: 7, productionTargets: [target()] } });
  });

  it.each([0, 61, 1.5, -1, "7", Number.NaN])("refuses a horizon of %j", (planningDays) => {
    const result = validateContentPlanningConfig(config({ planningDays }), options);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join()).toMatch(/planning horizon/i);
  });

  it("accepts the horizon bounds 1 and 60", () => {
    expect(validateContentPlanningConfig(config({ planningDays: 1 }), options).ok).toBe(true);
    expect(validateContentPlanningConfig(config({ planningDays: 60 }), options).ok).toBe(true);
  });

  it("refuses an unknown format", () => {
    const result = validateContentPlanningConfig(config({ productionTargets: [target({ contentType: "podcast" })] }), options);
    expect(!result.ok && result.errors.join()).toMatch(/format "podcast"/);
  });

  it("refuses an unknown Publish target", () => {
    const result = validateContentPlanningConfig(config({ productionTargets: [target({ publishTargets: ["nowhere:x"] })] }), options);
    expect(!result.ok && result.errors.join()).toMatch(/Publish target "nowhere:x"/);
  });

  it("refuses a format listed twice, a quantity that is not a positive integer and a target without destination", () => {
    expect(validateContentPlanningConfig(config({ productionTargets: [target(), target()] }), options).ok).toBe(false);
    for (const quantity of [0, -2, 1.5, "3"]) {
      expect(validateContentPlanningConfig(config({ productionTargets: [target({ quantity })] }), options).ok).toBe(false);
    }
    expect(validateContentPlanningConfig(config({ productionTargets: [target({ publishTargets: [] })] }), options).ok).toBe(false);
  });

  it("refuses a total quantity above 100 and accepts exactly 100", () => {
    const split = (a: number, b: number) => config({ productionTargets: [target({ quantity: a }), target({ contentType: "image", quantity: b })] });
    expect(validateContentPlanningConfig(split(60, 40), options).ok).toBe(true);
    const over = validateContentPlanningConfig(split(60, 41), options);
    expect(!over.ok && over.errors.join()).toMatch(/100/);
  });

  it("refuses a config that is not an object", () => {
    expect(validateContentPlanningConfig(null, options).ok).toBe(false);
    expect(validateContentPlanningConfig({ planningDays: 7, productionTargets: "x" }, options).ok).toBe(false);
  });
});

describe("config readers", () => {
  it("default the horizon and the targets when the config holds none", () => {
    expect(planningDaysOf({})).toBe(DEFAULT_PLANNING_DAYS);
    expect(planningDaysOf({ planningDays: 90 })).toBe(DEFAULT_PLANNING_DAYS);
    expect(planningDaysOf({ planningDays: 14 })).toBe(14);
    expect(productionTargetsOf({})).toEqual([]);
    expect(productionTargetsOf({ productionTargets: [target(), { nope: 1 }] })).toEqual([target()]);
  });
});

describe("usableTargets", () => {
  it("keeps targets whose format and Publish targets still exist and reports what was ignored", () => {
    const targets = [target(), target({ contentType: "article" }), target({ contentType: "image", publishTargets: ["social:example", "gone:x"] })];
    const { usable, ignored } = usableTargets(targets, options);
    expect(usable).toEqual([target(), target({ contentType: "image", publishTargets: ["social:example"] })]);
    expect(ignored).toEqual([expect.stringContaining("article"), expect.stringContaining("gone:x")]);
  });

  it("drops a target whose Publish targets all disappeared", () => {
    expect(usableTargets([target({ publishTargets: ["gone:x"] })], options).usable).toEqual([]);
  });
});
