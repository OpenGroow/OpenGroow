/**
 * Interpolation of review-action effects (path and body). The only references
 * are `{id}`, `{input.<key>}` and `{payload.<key>}`: the external job, what the
 * reviewer typed and the Mission's own payload. Nothing else resolves, so a
 * package cannot read platform secrets or another Agent's data (#670).
 *
 * - `{id}` → the external job ID (Artifact externalId).
 * - `{input.<key>}` → user-supplied action input (filled at review time).
 * - `{payload.<key>}` → value from the mission payload (set at mission creation).
 *   A bare payload reference preserves arrays and objects for JSON request bodies.
 *
 * When `encode` is true (path context), all substituted values are percent-encoded
 * so user-controlled input cannot smuggle extra path segments or query strings.
 * When `encode` is false (body context), values are substituted verbatim.
 *
 * Substitution is a single pass: a substituted value is never scanned again, so
 * a value that itself looks like a reference stays text. Only own keys resolve
 * (never `constructor`, `__proto__`).
 */
export function interpolateReviewTemplate(
  template: string,
  externalId: string,
  userInput: Record<string, string>,
  encode: boolean,
  missionPayload?: Record<string, unknown>,
): unknown {
  const own = (source: Record<string, unknown> | undefined, key: string): unknown =>
    source !== undefined && Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;

  // A bare payload reference must preserve its JSON value. This is needed for
  // video publication, where `platform` is an array of targets rather than a
  // single string.
  const barePayloadRef = /^\{payload\.([^}]+)\}$/.exec(template);
  if (!encode && barePayloadRef) {
    const value = own(missionPayload, barePayloadRef[1]);
    return value === undefined || value === null ? "" : value;
  }

  const encodeValue = (v: unknown) => (encode ? encodeURIComponent(String(v)) : String(v));
  return template.replace(/\{(id|input\.[^}]+|payload\.[^}]+)\}/g, (_match, ref: string) => {
    if (ref === "id") return encodeValue(externalId);
    if (ref.startsWith("input.")) {
      const value = own(userInput, ref.slice("input.".length));
      return encodeValue(typeof value === "string" ? value : "");
    }
    const value = own(missionPayload, ref.slice("payload.".length));
    return encodeValue(typeof value === "string" ? value : "");
  });
}
