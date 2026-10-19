const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

const formatter = new Intl.RelativeTimeFormat("en", { numeric: "always" });

/** "2 hours ago", "3 days ago", "just now" for a timestamp in epoch milliseconds. */
export function relativeTime(timestamp: number, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  for (const [unit, size] of UNITS) {
    if (elapsed >= size) return formatter.format(-Math.floor(elapsed / size), unit);
  }
  return "just now";
}
