/** Waterfall geometry of Trace Events. Pure; an event without a start timestamp gets no bar. */

export const MIN_BAR_WIDTH_PCT = 1.5;

export type TimelineBar = { offsetPct: number; widthPct: number };

export type TimelineLayout = {
  /** Span from the first start to the last known end; undefined when no event has a timestamp. */
  totalMs?: number;
  bars: Map<string, TimelineBar>;
};

type Timed = { id: string; startedAt?: string; endedAt?: string };

const parse = (iso?: string): number | undefined => {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
};

export function computeTimelineLayout(events: readonly Timed[]): TimelineLayout {
  const spans: { id: string; start: number; end: number }[] = [];
  for (const e of events) {
    const start = parse(e.startedAt);
    if (start === undefined) continue;
    const end = parse(e.endedAt);
    spans.push({ id: e.id, start, end: end !== undefined && end >= start ? end : start });
  }
  const bars = new Map<string, TimelineBar>();
  if (spans.length === 0) return { bars };
  const origin = Math.min(...spans.map((s) => s.start));
  const totalMs = Math.max(...spans.map((s) => s.end)) - origin;
  for (const s of spans) {
    const widthPct = totalMs === 0 ? MIN_BAR_WIDTH_PCT : Math.max(((s.end - s.start) / totalMs) * 100, MIN_BAR_WIDTH_PCT);
    const offsetPct = totalMs === 0 ? 0 : Math.min(((s.start - origin) / totalMs) * 100, 100 - widthPct);
    bars.set(s.id, { offsetPct, widthPct });
  }
  return { totalMs, bars };
}
