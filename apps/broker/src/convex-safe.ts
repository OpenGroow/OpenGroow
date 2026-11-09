// Convex refuses an object whose field name starts with "$" or holds anything
// but printable ASCII, or exceeds 1024 characters. An event payload is whatever
// the runtime saw: a tool result with a JSON Schema ("$schema", "$ref", "$defs")
// or an accented key is enough to make the whole event un-storable, and with it
// a session transcript that can never be read. Such names are escaped, never
// dropped: "$schema" becomes "%24schema". Display only: the key is not decoded.

const MAX_FIELD_NAME_LENGTH = 1024;

function isPrintableAscii(char: string): boolean {
  return char.length === 1 && char.charCodeAt(0) >= 32 && char.charCodeAt(0) < 127;
}

function escapeChar(char: string): string {
  try {
    return encodeURIComponent(char);
  } catch {
    return "%EF%BF%BD"; // a lone surrogate: U+FFFD
  }
}

export function convexSafeKey(key: string): string {
  const head = key.startsWith("$") ? `%24${key.slice(1)}` : key;
  const safe = [...head].map((char) => (isPrintableAscii(char) ? char : escapeChar(char))).join("");
  return safe.slice(0, MAX_FIELD_NAME_LENGTH);
}

/** A copy of `value` whose object field names are all valid Convex field names. Values are untouched. */
export function convexSafe<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => convexSafe(item)) as T;
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    let safeKey = convexSafeKey(key);
    while (safeKey in out) safeKey = `${safeKey}_`; // two names escaped to the same one: keep both
    out[safeKey] = convexSafe(item);
  }
  return out as T;
}
