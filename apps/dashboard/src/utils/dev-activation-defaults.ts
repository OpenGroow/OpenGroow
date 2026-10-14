/**
 * Local-development convenience: pre-fill the agent activation form so you don't
 * re-type the whole config on every activate/deactivate cycle.
 *
 * These are dev test values, applied ONLY outside production (see
 * `devActivationDefaults`), so they never pre-fill the form for real users.
 * Keys match the activation form field keys (see the manifest requirements).
 *
 * The three credential fields are intentionally blank — paste your own dev
 * values here once and they will be filled in on every activation.
 */
const DEV_ACTIVATION_DEFAULTS: Record<string, Record<string, string>> = {
  // The article and video MCPs now own their Project config end-to-end via
  // their own dashboards (issue #320, ADR-034) — OpenGroow's activation form
  // only asks for the apiKey, so there is nothing else to pre-fill here.
  "@opengroow/seo": {
    apiKey: "", // ← paste your dev article MCP API key
  },
  "@opengroow/video-demo": {
    apiKey: "", // ← paste your dev video MCP API key
  },
};

/**
 * Returns the dev pre-fill values for a template, or `undefined` outside local
 * development (production and test get an empty form, like real users) and for
 * templates with no configured defaults.
 */
export function devActivationDefaults(templateId: string): Record<string, string> | undefined {
  if (process.env.NODE_ENV !== "development") return undefined;
  return DEV_ACTIVATION_DEFAULTS[templateId];
}
