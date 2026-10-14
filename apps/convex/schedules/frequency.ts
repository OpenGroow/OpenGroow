/**
 * Frequency engine — pure, no Convex/DB access.
 *
 * Given a structured recurrence, an IANA timezone and a starting instant,
 * `computeNextRunAt` returns the next slot strictly in the future, in UTC ms.
 *
 * The "no catch-up" policy lives here: we always return the next future slot,
 * never an accumulation of missed past slots.
 *
 * Slice 1 only implements `daily`. Weekly/monthly are accepted by the type but
 * throw until their slices land, so a miswired caller fails loudly rather than
 * silently scheduling at the wrong time.
 */

export type Frequency = {
  unit: "daily" | "weekly" | "monthly";
  dayOfWeek?: number; // 0–6, for weekly
  dayOfMonth?: number; // 1–31, for monthly
  hour: number; // 0–23
  minute: number; // 0–59
};

type LocalParts = {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** Wall-clock parts of a UTC instant, as seen in `timeZone`. */
function partsInZone(timeZone: string, utcMs: number): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const p of fmt.formatToParts(utcMs)) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
  };
}

/** Offset (local - UTC) in ms that `timeZone` applies at the given UTC instant. */
function offsetMs(timeZone: string, utcMs: number): number {
  const p = partsInZone(timeZone, utcMs);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - utcMs;
}

/** Number of days in a 1-based month (handles leap Februaries). */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** UTC ms for a wall-clock time in `timeZone`, resolving the DST offset. */
function wallTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = offsetMs(timeZone, guess);
  let utc = guess - offset;
  // Refine once: near a DST transition the offset at `guess` may differ from the
  // offset at the corrected instant.
  const offset2 = offsetMs(timeZone, utc);
  if (offset2 !== offset) {
    utc = guess - offset2;
  }
  return utc;
}

export function computeNextRunAt(
  frequency: Frequency,
  timezone: string,
  fromMs: number,
): number {
  const { hour, minute } = frequency;
  const local = partsInZone(timezone, fromMs);

  // Wall-clock `hour:minute` on the calendar day a UTC `Date` points at.
  const slotOnDate = (date: Date): number =>
    wallTimeToUtc(
      timezone,
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      hour,
      minute,
    );

  if (frequency.unit === "daily") {
    const day = new Date(Date.UTC(local.year, local.month - 1, local.day));
    let candidate = slotOnDate(day);
    if (candidate <= fromMs) {
      day.setUTCDate(day.getUTCDate() + 1);
      candidate = slotOnDate(day);
    }
    return candidate;
  }

  if (frequency.unit === "weekly") {
    const target = frequency.dayOfWeek ?? 0;
    const day = new Date(Date.UTC(local.year, local.month - 1, local.day));
    day.setUTCDate(day.getUTCDate() + ((target - day.getUTCDay() + 7) % 7));
    let candidate = slotOnDate(day);
    if (candidate <= fromMs) {
      day.setUTCDate(day.getUTCDate() + 7);
      candidate = slotOnDate(day);
    }
    return candidate;
  }

  if (frequency.unit === "monthly") {
    const targetDom = frequency.dayOfMonth ?? 1;
    // Clamp the requested day to the month's length so short months (e.g. Feb
    // for a "31st" schedule) still fire — on their last day rather than skipping.
    const slotInMonth = (year: number, month: number): number => {
      const day = Math.min(targetDom, daysInMonth(year, month));
      return wallTimeToUtc(timezone, year, month, day, hour, minute);
    };

    let candidate = slotInMonth(local.year, local.month);
    if (candidate <= fromMs) {
      const nextMonth = local.month === 12 ? 1 : local.month + 1;
      const nextYear = local.month === 12 ? local.year + 1 : local.year;
      candidate = slotInMonth(nextYear, nextMonth);
    }
    return candidate;
  }

  throw new Error(`computeNextRunAt: unit "${frequency.unit}" not implemented yet`);
}
