import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import { buildProjectOverview, overviewGroup } from "../project_overview";

const DAY = 24 * 60 * 60 * 1000;
const UNTIL = 1_800_000_000_000;

function mission(
  n: number,
  status: Parameters<typeof overviewGroup>[0],
  createdAgoDays: number,
  templateId = "@opengroow/seo",
) {
  const createdAt = UNTIL - createdAgoDays * DAY;
  return {
    _id: `m${n}` as Id<"missions">,
    number: n,
    templateId,
    type: "article",
    status,
    createdAt,
    updatedAt: createdAt + 1000,
  };
}

describe("overviewGroup", () => {
  it("folds Mission statuses into the five Overview groups", () => {
    expect(overviewGroup("todo")).toBe("progress");
    expect(overviewGroup("doing")).toBe("progress");
    expect(overviewGroup("to_validate")).toBe("review");
    expect(overviewGroup("approved")).toBe("review");
    expect(overviewGroup("blocked")).toBe("review");
    expect(overviewGroup("done")).toBe("done");
    expect(overviewGroup("failed")).toBe("failed");
    expect(overviewGroup("cancelled")).toBe("stopped");
  });
});

describe("buildProjectOverview", () => {
  const base = { days: 7, until: UNTIL, tzOffsetMinutes: 0 };

  it("counts the current period as a cohort and the previous period for the delta", () => {
    const result = buildProjectOverview({
      ...base,
      runs: [],
      missions: [
        mission(1, "done", 1),
        mission(2, "done", 2),
        mission(3, "failed", 3),
        mission(4, "doing", 0.5),
        mission(5, "done", 9),
        mission(6, "done", 20),
      ],
    });
    expect(result.total).toBe(4);
    expect(result.counts).toMatchObject({ done: 2, failed: 1, progress: 1, review: 0 });
    expect(result.previous).toMatchObject({ total: 1, done: 1 });
    expect(result.buckets.reduce((sum, b) => sum + b.total, 0)).toBe(4);
  });

  it("ranks Agents by volume with a success rate over settled Missions", () => {
    const result = buildProjectOverview({
      ...base,
      runs: [],
      missions: [
        mission(1, "done", 1, "@opengroow/seo"),
        mission(2, "failed", 1, "@opengroow/seo"),
        mission(3, "doing", 1, "@opengroow/seo"),
        mission(4, "doing", 1, "@opengroow/source"),
      ],
    });
    expect(result.agents.map((a) => a.templateId)).toEqual(["@opengroow/seo", "@opengroow/source"]);
    expect(result.agents[0].successRate).toBe(0.5);
    expect(result.agents[1].successRate).toBeNull();
  });

  it("averages run durations completed in the period and ignores unfinished Runs", () => {
    const completedAt = UNTIL - DAY;
    const result = buildProjectOverview({
      ...base,
      missions: [mission(1, "done", 1)],
      runs: [
        { templateId: "@opengroow/seo", dispatchedAt: completedAt - 60_000, completedAt },
        { templateId: "@opengroow/seo", dispatchedAt: completedAt - 180_000, completedAt },
        { templateId: "@opengroow/seo", dispatchedAt: undefined, completedAt },
      ],
    });
    expect(result.avgRunMs).toBe(120_000);
    expect(result.agents[0].avgRunMs).toBe(120_000);
    expect(result.previous.avgRunMs).toBeNull();
  });

  it("lists the most recently updated Missions as activity", () => {
    const result = buildProjectOverview({
      ...base,
      runs: [],
      missions: Array.from({ length: 9 }, (_, i) => mission(i + 1, "done", 6 - i * 0.5)),
    });
    expect(result.recent).toHaveLength(6);
    expect(result.recent[0].number).toBe(9);
  });
});
