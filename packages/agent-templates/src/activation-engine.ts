import type { ActivationBodyNode } from "./types";

/**
 * Sentinel symbol returned by interpolation when a leaf should be omitted.
 * Not exported — only used within this module.
 */
const OMIT = Symbol("OMIT");

/**
 * Context for resolving interpolation references.
 * `responseId` is populated after the HTTP call returns, for the second-pass
 * interpolation of the persisted-config body tree (which may contain `{responseId}`).
 */
export type RefContext = {
  userConfig: Record<string, unknown>;
  config: Record<string, unknown>;
  /** The id extracted from the activation response. Used to resolve `{responseId}` leaves. */
  responseId?: string;
};

/**
 * Only the Agent's own keys resolve: an inherited property (`constructor`,
 * `__proto__`) is never a configuration value (#670).
 */
function ownValue(source: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
}

/**
 * Resolve a single interpolation reference like `{key}`, `{config.key}`, or `{responseId}`.
 * Returns the resolved value, or OMIT if the value is empty / undefined.
 */
function resolveRef(ref: string, ctx: RefContext): unknown | typeof OMIT {
  const configPrefix = "config.";
  let value: unknown;
  if (ref === "responseId") {
    value = ctx.responseId;
  } else if (ref.startsWith(configPrefix)) {
    const key = ref.slice(configPrefix.length);
    value = ownValue(ctx.config, key);
  } else {
    value = ownValue(ctx.userConfig, ref);
  }
  if (value === undefined || value === null || value === "") {
    return OMIT;
  }
  return value;
}

/**
 * Interpolate a single string leaf.
 * If the string is a bare `{ref}` expression, resolve it.
 * Otherwise return the literal string as-is.
 * Returns OMIT if the reference resolves to empty.
 */
function interpolateString(s: string, ctx: RefContext): unknown | typeof OMIT {
  const bareRefMatch = /^\{([^}]+)\}$/.exec(s);
  if (bareRefMatch) {
    return resolveRef(bareRefMatch[1], ctx);
  }
  // Partial interpolation: replace {ref} occurrences inside a larger string.
  // If ANY reference resolves to OMIT the whole string is OMIT.
  const partialPattern = /\{([^}]+)\}/g;
  if (!partialPattern.test(s)) {
    // No interpolation references — literal string, never OMIT.
    return s;
  }
  // Reset lastIndex after test().
  let hasRef = false;
  let anyOmitted = false;
  const replaced = s.replace(/\{([^}]+)\}/g, (_, ref: string) => {
    hasRef = true;
    const resolved = resolveRef(ref, ctx);
    if (resolved === OMIT) {
      anyOmitted = true;
      return "";
    }
    return String(resolved);
  });
  if (!hasRef) return s;
  // If ANY embedded reference resolved to empty, omit the whole leaf rather than
  // emit a half-interpolated value (e.g. a dangling prefix) — ADR-021 omission rule.
  return anyOmitted ? OMIT : replaced;
}

/**
 * Determine whether a string contains at least one `{ref}` interpolation.
 */
function hasInterpolation(s: string): boolean {
  return /\{[^}]+\}/.test(s);
}

/**
 * Recursively interpolate an ActivationBodyNode.
 *
 * Omission rule:
 * - A string leaf that resolves to empty/undefined → OMIT (do not include).
 * - An object node where ALL interpolated string descendants resolve to OMIT
 *   → on POST: OMIT (omit entirely); on PATCH: null (send null to clear).
 * - Literal strings (no `{ref}`) are never omitted.
 *
 * @returns The interpolated value, OMIT, or null (patch-clear).
 */
export function interpolateActivationBody(
  body: ActivationBodyNode,
  ctx: RefContext,
  isPatch: boolean,
): unknown | typeof OMIT {
  if (body === null || typeof body === "number" || typeof body === "boolean") {
    return body;
  }

  if (typeof body === "string") {
    return interpolateString(body, ctx);
  }

  // Object node.
  // We first collect all interpolated and literal children separately, then
  // decide whether the object as a whole should be included.
  //
  // Key rule (ADR-021): if an object has interpolated descendants AND every
  // interpolated descendant resolves to OMIT, the whole object is omitted
  // (POST) or nulled (PATCH) — even if it also has literal-string fields.
  // Literal strings in an object are "passengers" that tag along only when
  // at least one interpolated field has a value.
  const result: Record<string, unknown> = {};
  const literalKeys: string[] = [];           // keys from non-interpolated strings
  let interpolatedLeafCount = 0;
  let omittedInterpolatedLeafCount = 0;

  for (const [key, value] of Object.entries(body)) {
    const interpolated = interpolateActivationBody(value, ctx, isPatch);

    if (interpolated === OMIT) {
      interpolatedLeafCount++;
      omittedInterpolatedLeafCount++;
      continue;
    }

    if (interpolated === null) {
      result[key] = null;
      interpolatedLeafCount++;
    } else if (typeof interpolated === "string") {
      const originalStr = typeof value === "string" ? value : null;
      if (originalStr !== null && hasInterpolation(originalStr)) {
        interpolatedLeafCount++;
        result[key] = interpolated;
      } else {
        // Literal string (no {ref}) — it is a passenger.
        literalKeys.push(key);
        result[key] = interpolated;
      }
    } else {
      result[key] = interpolated;
      // A resolved child object (or non-string primitive) counts as a non-omitted
      // interpolated descendant so the parent object is not incorrectly OMIT'd
      // when sibling keys resolve to OMIT.
      interpolatedLeafCount++;
    }
  }

  // If all interpolated descendants were omitted, the whole object is omitted.
  // Literal-string passengers do NOT prevent the omission.
  if (interpolatedLeafCount > 0 && omittedInterpolatedLeafCount === interpolatedLeafCount) {
    return isPatch ? null : OMIT;
  }

  // No interpolated descendants at all — return the object (may be empty or
  // contain only literals; don't silently drop it).
  if (interpolatedLeafCount === 0 && literalKeys.length > 0) {
    return result;
  }

  // Mixed case or empty: return whatever is in result.
  return result;
}

/**
 * Export the OMIT sentinel for use in tests.
 */
export { OMIT };

/**
 * Derive the config id key from a body tree by finding the key whose leaf value
 * is the bare `{responseId}` reference (ADR-021, point 3).
 *
 * The search is shallow: the leaf must be a direct string value `"{responseId}"` at
 * any depth in the tree. Returns the first matching key found, or undefined if none.
 *
 * Example:
 *   { seoProjectId: "{responseId}" }  → "seoProjectId"
 *   { videoProjectId: "{responseId}" } → "videoProjectId"
 */
export function deriveConfigIdKey(body: ActivationBodyNode | undefined): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  for (const [key, value] of Object.entries(body)) {
    if (value === "{responseId}") return key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = deriveConfigIdKey(value);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

/**
 * Extract a nested value from a response body using a dotted path.
 * E.g. "project.id" → responseBody.project.id
 */
export function extractResponseId(
  responseBody: Record<string, unknown>,
  responseIdField: string,
): string {
  const parts = responseIdField.split(".");
  let current: unknown = responseBody;
  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      throw new Error(`Cannot traverse responseIdField "${responseIdField}": intermediate value at "${part}" is not an object`);
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current !== "string") {
    throw new Error(`responseIdField "${responseIdField}" resolved to ${JSON.stringify(current)}, expected a string`);
  }
  return current;
}
