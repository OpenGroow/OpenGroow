import { describe, it, expect } from "vitest";
import { validateManifest } from "./index.js";

const withSchedule = (defaultSchedule: unknown) => ({
  id: "strategy",
  name: "Strategy",
  description: "Plans the next Missions",
  category: "demo",
  mcpServers: [],
  missionTypes: [{ type: "plan", label: "Plan", payload: "{}", agentsMd: "plan.md", defaultSchedule }],
});

describe("missionTypes[].defaultSchedule", () => {
  it("accepts a weekly cadence", () => {
    expect(validateManifest(withSchedule({ unit: "weekly", dayOfWeek: 1, hour: 8, minute: 0 })).ok).toBe(true);
  });

  it("accepts a daily and a monthly cadence", () => {
    expect(validateManifest(withSchedule({ unit: "daily", hour: 8, minute: 30 })).ok).toBe(true);
    expect(validateManifest(withSchedule({ unit: "monthly", dayOfMonth: 1, hour: 8, minute: 0 })).ok).toBe(true);
  });

  it("refuses a weekly cadence without a day of the week", () => {
    expect(validateManifest(withSchedule({ unit: "weekly", hour: 8, minute: 0 })).ok).toBe(false);
  });

  it("refuses an out-of-range time, an unknown unit and an unknown key", () => {
    expect(validateManifest(withSchedule({ unit: "weekly", dayOfWeek: 1, hour: 24, minute: 0 })).ok).toBe(false);
    expect(validateManifest(withSchedule({ unit: "hourly", hour: 1, minute: 0 })).ok).toBe(false);
    expect(validateManifest(withSchedule({ unit: "daily", hour: 1, minute: 0, timezone: "UTC" })).ok).toBe(false);
  });
});
