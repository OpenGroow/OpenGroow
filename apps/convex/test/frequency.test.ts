import { describe, expect, it } from "vitest";
import { computeNextRunAt } from "../schedules/frequency";

/** Local wall-clock {hour, minute} of a UTC instant, as seen in `timeZone`. */
function localHourMinute(ms: number, timeZone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(ms);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { hour: get("hour"), minute: get("minute") };
}

/** Local calendar Y/M/D of a UTC instant, as seen in `timeZone`. */
function localYMD(ms: number, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ms);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Local day-of-week (0=Sun…6=Sat) of a UTC instant, as seen in `timeZone`. */
function localWeekday(ms: number, timeZone: string): number {
  const { year, month, day } = localYMD(ms, timeZone);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

describe("computeNextRunAt (daily)", () => {
  it("returns the next strictly-future slot at the chosen hour:minute in the timezone", () => {
    // 2026-06-04T06:00:00Z — in Europe/Paris (UTC+2 in June) this is 08:00 local.
    const from = Date.UTC(2026, 5, 4, 6, 0, 0);

    const next = computeNextRunAt({ unit: "daily", hour: 9, minute: 30 }, "Europe/Paris", from);

    expect(next).toBeGreaterThan(from);
    expect(localHourMinute(next, "Europe/Paris")).toEqual({ hour: 9, minute: 30 });
  });

  it("advances to the next day when fromMs lands exactly on the slot (no catch-up, strictly future)", () => {
    // Pick the exact slot first, then ask again from that instant.
    const seed = Date.UTC(2026, 5, 4, 0, 0, 0);
    const slot = computeNextRunAt({ unit: "daily", hour: 9, minute: 0 }, "Europe/Paris", seed);

    const next = computeNextRunAt({ unit: "daily", hour: 9, minute: 0 }, "Europe/Paris", slot);

    expect(next).toBeGreaterThan(slot);
    // Exactly 24h later here (no DST transition between June days).
    expect(next - slot).toBe(24 * 60 * 60 * 1000);
    expect(localHourMinute(next, "Europe/Paris")).toEqual({ hour: 9, minute: 0 });
  });

  it("keeps the local hour fixed across a spring-forward DST transition", () => {
    // Europe/Paris springs forward 2026-03-29 (02:00 → 03:00 local, +1 → +2).
    // A daily 09:00 slot must stay at 09:00 local on both sides of the jump.
    const beforeJump = Date.UTC(2026, 2, 28, 0, 0, 0); // Mar 28, well before 09:00 local
    const slotMar28 = computeNextRunAt({ unit: "daily", hour: 9, minute: 0 }, "Europe/Paris", beforeJump);
    const slotMar29 = computeNextRunAt({ unit: "daily", hour: 9, minute: 0 }, "Europe/Paris", slotMar28);

    expect(localHourMinute(slotMar28, "Europe/Paris")).toEqual({ hour: 9, minute: 0 });
    expect(localHourMinute(slotMar29, "Europe/Paris")).toEqual({ hour: 9, minute: 0 });
    // Offset went +1h → +2h overnight, so wall-clock 09:00→09:00 is only 23h apart.
    expect(slotMar29 - slotMar28).toBe(23 * 60 * 60 * 1000);
  });
});

describe("computeNextRunAt (weekly)", () => {
  it("returns the next strictly-future slot on the chosen day-of-week at hour:minute", () => {
    // 2026-06-04 is a Thursday. Ask for Monday (1) at 09:00 Europe/Paris.
    const from = Date.UTC(2026, 5, 4, 6, 0, 0);

    const next = computeNextRunAt(
      { unit: "weekly", dayOfWeek: 1, hour: 9, minute: 0 },
      "Europe/Paris",
      from,
    );

    expect(next).toBeGreaterThan(from);
    expect(localWeekday(next, "Europe/Paris")).toBe(1);
    expect(localHourMinute(next, "Europe/Paris")).toEqual({ hour: 9, minute: 0 });
  });

  it("jumps a full week when fromMs lands exactly on the slot of the target day", () => {
    const seed = Date.UTC(2026, 5, 1, 0, 0, 0);
    const slot = computeNextRunAt({ unit: "weekly", dayOfWeek: 1, hour: 9, minute: 0 }, "Europe/Paris", seed);

    const next = computeNextRunAt({ unit: "weekly", dayOfWeek: 1, hour: 9, minute: 0 }, "Europe/Paris", slot);

    expect(next).toBeGreaterThan(slot);
    expect(localWeekday(next, "Europe/Paris")).toBe(1);
    expect(next - slot).toBe(7 * 24 * 60 * 60 * 1000); // no DST in June, exactly 7 days
  });
});

describe("computeNextRunAt (monthly)", () => {
  it("returns the next strictly-future slot on the chosen day-of-month at hour:minute", () => {
    // 2026-06-04 → next 15th at 09:00 is 2026-06-15 (still this month).
    const from = Date.UTC(2026, 5, 4, 6, 0, 0);

    const next = computeNextRunAt(
      { unit: "monthly", dayOfMonth: 15, hour: 9, minute: 0 },
      "Europe/Paris",
      from,
    );

    expect(next).toBeGreaterThan(from);
    expect(localYMD(next, "Europe/Paris").day).toBe(15);
    expect(localHourMinute(next, "Europe/Paris")).toEqual({ hour: 9, minute: 0 });
  });

  it("clamps a day-31 schedule to the last day of a shorter month (Feb)", () => {
    // From 2026-02-01, the 31st doesn't exist in February (28 days, non-leap):
    // it fires on the last day, Feb 28.
    const from = Date.UTC(2026, 1, 1, 6, 0, 0);

    const next = computeNextRunAt(
      { unit: "monthly", dayOfMonth: 31, hour: 9, minute: 0 },
      "Europe/Paris",
      from,
    );

    const ymd = localYMD(next, "Europe/Paris");
    expect(ymd.month).toBe(2);
    expect(ymd.day).toBe(28);
    expect(localHourMinute(next, "Europe/Paris")).toEqual({ hour: 9, minute: 0 });
  });

  it("clamps a day-31 schedule to Feb 29 in a leap year", () => {
    // 2028 is a leap year → Feb has 29 days.
    const from = Date.UTC(2028, 1, 1, 6, 0, 0);

    const next = computeNextRunAt(
      { unit: "monthly", dayOfMonth: 31, hour: 9, minute: 0 },
      "Europe/Paris",
      from,
    );

    const ymd = localYMD(next, "Europe/Paris");
    expect(ymd.month).toBe(2);
    expect(ymd.day).toBe(29);
  });

  it("keeps 09:00 local on a monthly slot that falls on the DST spring-forward day", () => {
    // 2026-03-29 is the Europe/Paris spring-forward day (02:00 → 03:00). A
    // monthly slot on the 29th at 09:00 must still resolve to 09:00 local.
    const from = Date.UTC(2026, 2, 10, 6, 0, 0);

    const next = computeNextRunAt(
      { unit: "monthly", dayOfMonth: 29, hour: 9, minute: 0 },
      "Europe/Paris",
      from,
    );

    const ymd = localYMD(next, "Europe/Paris");
    expect(ymd.month).toBe(3);
    expect(ymd.day).toBe(29);
    expect(localHourMinute(next, "Europe/Paris")).toEqual({ hour: 9, minute: 0 });
  });
});
