const TRACKING_PARAM = /^(utm_.*|fbclid|gclid|dclid|msclkid|igsh|igshid|mc_cid|mc_eid|ref_src|si)$/i;

/**
 * The one spelling of a post's public URL (ADR-078): lowercase scheme and host,
 * no fragment, no tracking parameters, remaining parameters sorted, no trailing
 * slash. Applied when a URL is stored and again when one is matched, so both
 * sides agree. A value that is not a URL is returned trimmed.
 */
export function normalizePostUrl(input: string): string {
  const raw = input.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  const kept = [...url.searchParams.entries()].filter(([key]) => !TRACKING_PARAM.test(key));
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const search = new URLSearchParams(kept).toString();
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${path}${search ? `?${search}` : ""}`;
}
