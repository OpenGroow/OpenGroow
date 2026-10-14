import type { ActivationEffect } from "./types";
import { interpolateActivationBody, extractResponseId, deriveConfigIdKey, type RefContext, OMIT } from "./activation-engine";

/**
 * Execute a declarative ActivationEffect (ADR-021).
 *
 * 1. Interpolates the path (replaces `{config.X}` with existingConfig[X]).
 * 2. Interpolates the body tree (without `{responseId}` — that's resolved after the call).
 * 3. Performs the HTTP POST or PATCH.
 * 4. On 409 with treatConflictAsExisting, parses response body anyway.
 * 5. Extracts the responseId via the dotted responseIdField.
 * 6. Derives the config id key from the body tree (the key holding `{responseId}`).
 * 7. Returns flat stored config: all userConfig keys (strings) + derived configIdKey: responseId.
 *
 * The id key is DERIVED, not declared: whichever key in the body tree holds a
 * `{responseId}` leaf becomes the frozen id key (ADR-021, point 3). This means
 * `configIdKey` no longer needs to be declared separately on the effect.
 *
 * @param effect        The declarative effect from the manifest.
 * @param userConfig    The flat form fields submitted by the user.
 * @param existingConfig The agent's existing persisted config (holds frozen ids for PATCH).
 * @param serverOrigin  The base URL of the MCP server (e.g. http://localhost:4000).
 * @param apiKey        The API key used for Bearer authentication.
 */
export async function executeActivationEffect(
  effect: ActivationEffect,
  userConfig: Record<string, unknown>,
  existingConfig: Record<string, unknown>,
  serverOrigin: string,
  apiKey: string,
): Promise<{ config: Record<string, unknown> }> {
  const isPatch = effect.method === "PATCH";
  const ctx: RefContext = { userConfig, config: existingConfig };

  // Interpolate path: replace {config.X} references.
  const path = effect.path.replace(/\{config\.([^}]+)\}/g, (_, key: string) => {
    const value = existingConfig[key];
    return typeof value === "string" ? value : "";
  });

  // Interpolate body (first pass: without responseId, which is unknown pre-call).
  let bodyPayload: unknown = undefined;
  if (effect.body !== undefined) {
    const interpolated = interpolateActivationBody(effect.body, ctx, isPatch);
    // OMIT at top-level body means send no body.
    if (interpolated !== OMIT) {
      bodyPayload = interpolated;
    }
  }

  const url = `${serverOrigin}${path}`;
  const response = await fetch(url, {
    method: effect.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: bodyPayload !== undefined ? JSON.stringify(bodyPayload) : undefined,
  });

  if (!response.ok) {
    if (response.status === 409 && effect.treatConflictAsExisting) {
      // Fall through to parse the body below.
    } else {
      throw new Error(`${effect.method} ${path} failed: ${response.status} ${response.statusText}`);
    }
  }

  // Parse defensively: a successful PATCH may return an empty body (e.g. 204), and
  // `response.json()` throws on empty input — which would bypass the frozen-id
  // fallback below. Treat an unparseable/empty body as `{}` and let the response-id
  // extraction (or the PATCH fallback) decide what to do.
  let responseBody: Record<string, unknown>;
  try {
    responseBody = (await response.json()) as Record<string, unknown>;
  } catch {
    responseBody = {};
  }

  // Derive the config id key from the body tree (the key holding `{responseId}`).
  const derivedConfigIdKey = deriveConfigIdKey(effect.body);

  // Extract the responseId via the dotted responseIdField.
  // For PATCH (reconfiguration), the resource id is already frozen in the
  // existing config — the server may or may not echo it back in the response.
  // Fall back to the existing value when the response doesn't contain the field.
  let responseId: string;
  try {
    responseId = extractResponseId(responseBody, effect.responseIdField);
  } catch (extractErr) {
    if (isPatch && derivedConfigIdKey !== undefined) {
      const existing = existingConfig[derivedConfigIdKey];
      if (typeof existing !== "string") {
        throw new Error(
          `Cannot reconfigure: responseIdField "${effect.responseIdField}" not in response ` +
            `and derived config id key "${derivedConfigIdKey}" not in existing config`,
        );
      }
      responseId = existing;
    } else if (isPatch && derivedConfigIdKey === undefined) {
      // No {responseId} leaf in body — PATCH without id is valid (just update config fields).
      // Build flat config without injecting an id.
      const flatConfig: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(existingConfig)) {
        flatConfig[k] = v;
      }
      for (const [k, v] of Object.entries(userConfig)) {
        if (v !== undefined) {
          flatConfig[k] = v;
        }
      }
      return { config: flatConfig };
    } else {
      throw extractErr;
    }
  }

  // Build flat config: all string userConfig values + frozen configIdKey (derived).
  const flatConfig: Record<string, unknown> = {};
  // Merge existing config first (preserves immutable fields from prior activations).
  for (const [k, v] of Object.entries(existingConfig)) {
    flatConfig[k] = v;
  }
  // Overlay all userConfig fields (form submission).
  for (const [k, v] of Object.entries(userConfig)) {
    if (v !== undefined) {
      flatConfig[k] = v;
    }
  }
  // Freeze the id under the derived key (whichever key held {responseId} in the body).
  if (derivedConfigIdKey !== undefined) {
    flatConfig[derivedConfigIdKey] = responseId;
  }

  return { config: flatConfig };
}
