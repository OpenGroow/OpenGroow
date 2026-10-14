function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string, defaultValue: string): string {
  return process.env[name]?.trim() || defaultValue;
}

function optionalMs(name: string, defaultValue: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.floor(parsed);
}

function optionalMsOrZero(name: string, defaultValue: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return defaultValue;
  if (raw === "0") return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return defaultValue;
  return Math.floor(parsed);
}

export const env = {
  // Auth
  get DASHBOARD_URL() { return required("DASHBOARD_URL"); },

  // Registration policy (#716 / ADR-059): "multi-account" opens sign-up for a
  // hosted deployment; anything else (default) keeps the single-account lock.
  get OPENGROOW_ACCOUNT_MODE() { return optional("OPENGROOW_ACCOUNT_MODE", ""); },

  // Broker
  get BROKER_URL() { return required("BROKER_URL"); },
  get BROKER_KEY_ID() { return required("BROKER_KEY_ID"); },
  get BROKER_SECRET() { return required("BROKER_SECRET"); },
  get BROKER_FETCH_TIMEOUT_MS() { return optionalMs("BROKER_FETCH_TIMEOUT_MS", 8_000); },

  // Which InstanceProvisioner is wired (instance_provisioning/index.ts):
  // "control-plane" (generic remote control-plane, the default) or "local"
  // (apps/openclaw-local-control, self-host). IS_SELF_HOST plays no part in
  // the choice.
  get INSTANCE_PROVISIONER(): "control-plane" | "local" {
    const raw = process.env.INSTANCE_PROVISIONER?.trim();
    if (!raw) return "control-plane";
    if (raw === "control-plane" || raw === "local") return raw;
    throw new Error(
      `Invalid INSTANCE_PROVISIONER "${raw}": expected "control-plane" or "local"`,
    );
  },

  // OpenClaw Control API: reached by whichever InstanceProvisioner is wired.
  // The remote control-plane (contract: docs/CONTROL_PLANE.md) and
  // apps/openclaw-local-control in self-host use the same three variables;
  // only one provisioner is ever active per deployment.
  get OPENCLAW_CONTROL_URL() { return required("OPENCLAW_CONTROL_URL"); },
  get OPENCLAW_CONTROL_KEY_ID() { return required("OPENCLAW_CONTROL_KEY_ID"); },
  get OPENCLAW_CONTROL_SECRET() { return required("OPENCLAW_CONTROL_SECRET"); },
  get OPENCLAW_CONTROL_FETCH_TIMEOUT_MS() { return optionalMs("OPENCLAW_CONTROL_FETCH_TIMEOUT_MS", 8_000); },

  // Connect tickets
  get OPENCLAW_CONNECT_PUBLIC_BASE_URL() {
    return optional("OPENCLAW_CONNECT_PUBLIC_BASE_URL", "http://localhost:4700");
  },
  get OPENCLAW_CONNECT_TICKET_TTL_MS() { return optionalMsOrZero("OPENCLAW_CONNECT_TICKET_TTL_MS", 30 * 60 * 1_000); },

  // Runtime timeouts
  get RUNTIME_AUTH_BROKER_TIMEOUT_MS() { return optionalMs("RUNTIME_AUTH_BROKER_TIMEOUT_MS", 15_000); },
  get RUNTIME_LINK_BROKER_TIMEOUT_MS() { return optionalMs("RUNTIME_LINK_BROKER_TIMEOUT_MS", 15_000); },
  get ACTIVATION_BROKER_TIMEOUT_MS() { return optionalMs("ACTIVATION_BROKER_TIMEOUT_MS", 30_000); },

  // Hub of installable Agent Templates (#668): a GitHub repository holding an index.json at `OPENGROOW_HUB_REF`.
  get OPENGROOW_HUB_REPOSITORY() { return optional("OPENGROOW_HUB_REPOSITORY", "OpenGroow/groowhub"); },
  get OPENGROOW_HUB_REF() { return optional("OPENGROOW_HUB_REF", "main"); },

  get OPENGROOW_ENABLE_DEMO_AGENTS() { return optional("OPENGROOW_ENABLE_DEMO_AGENTS", "") === "1"; },

  // Dev-only self-host preview (ADR-033) — see instance_provisioning/index.ts.
  get IS_SELF_HOST() { return optional("IS_SELF_HOST", "") === "1"; },

  // Comma-separated optional OpenClaw plugins the Instances install at start
  // (codex, whatsapp, xiaomi, groq). Empty by default: see optional_plugins.ts.
  get OPENCLAW_OPTIONAL_PLUGINS() { return optional("OPENCLAW_OPTIONAL_PLUGINS", ""); },

  // Mission dispatcher: hard timeout for runs in dispatching/running.
  get MISSION_RUN_MAX_MS() { return optionalMs("MISSION_RUN_MAX_MS", 900_000); },
};
