/** Display helpers for the Trace. Pure; an absent value renders as nothing, never an invented one. */

export function formatDurationMs(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  return `${m} min ${rest} s`;
}

/**
 * Run duration: elapsed time from Run creation to completion, or to `now` while
 * the Run is active. Undefined when a timestamp is missing.
 */
export function runDurationMs(
  run: { createdAt?: number; completedAt?: number },
  terminal: boolean,
  now: number = Date.now(),
): number | undefined {
  if (typeof run.createdAt !== "number") return undefined;
  const end = terminal ? run.completedAt : now;
  return typeof end === "number" ? end - run.createdAt : undefined;
}

/** Truncated one-line-ish preview of a payload, so large payloads never weigh on the DOM. */
export function previewPayload(value: unknown, max = 160): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
