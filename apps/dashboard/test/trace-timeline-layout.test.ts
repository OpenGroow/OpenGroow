import { describe, expect, it } from "vitest";
import { computeTimelineLayout, MIN_BAR_WIDTH_PCT } from "../src/lib/trace/timeline-layout";

const t = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
const ev = (id: string, startedAt?: string, endedAt?: string) => ({ id, startedAt, endedAt });

describe("computeTimelineLayout", () => {
  it("positions bars by start offset and observed duration over the total span", () => {
    const layout = computeTimelineLayout([ev("a", t(0)), ev("b", t(10), t(20)), ev("c", t(30))]);
    expect(layout.totalMs).toBe(30000);
    expect(layout.bars.get("b")?.offsetPct).toBeCloseTo(33.33, 1);
    expect(layout.bars.get("b")?.widthPct).toBeCloseTo(33.33, 1);
    expect(layout.bars.get("a")?.offsetPct).toBe(0);
  });

  it("gives instantaneous events a minimum visible width, kept inside the axis", () => {
    const layout = computeTimelineLayout([ev("a", t(0)), ev("b", t(30))]);
    expect(layout.bars.get("a")?.widthPct).toBe(MIN_BAR_WIDTH_PCT);
    const b = layout.bars.get("b")!;
    expect(b.offsetPct + b.widthPct).toBeLessThanOrEqual(100);
  });

  it("never invents a bar for events without a start timestamp", () => {
    const layout = computeTimelineLayout([ev("a", t(0)), ev("b"), ev("c", undefined, t(5)), ev("d", t(10))]);
    expect(layout.bars.has("b")).toBe(false);
    expect(layout.bars.has("c")).toBe(false);
    expect(layout.bars.has("a")).toBe(true);
  });

  it("handles a single event and a zero total duration", () => {
    const layout = computeTimelineLayout([ev("a", t(5))]);
    expect(layout.totalMs).toBe(0);
    expect(layout.bars.get("a")).toEqual({ offsetPct: 0, widthPct: MIN_BAR_WIDTH_PCT });
  });

  it("returns an empty layout without any timestamp", () => {
    const layout = computeTimelineLayout([ev("a")]);
    expect(layout.totalMs).toBeUndefined();
    expect(layout.bars.size).toBe(0);
  });

  it("ignores an end before its start", () => {
    const layout = computeTimelineLayout([ev("a", t(10), t(5)), ev("b", t(20))]);
    expect(layout.bars.get("a")?.widthPct).toBe(MIN_BAR_WIDTH_PCT);
  });
});
