// Official OpenClaw plugins an Instance can install on demand (issues #638,
// #639), listed in OPENCLAW_OPTIONAL_PLUGINS. Convex and the Dashboard parse
// the variable here; the Instance image has its own copy of the id list in
// apps/openclaw-docker-config/docker/optional-plugins.js (plain CommonJS).
export const OPTIONAL_PLUGIN_IDS = ["codex", "whatsapp", "xiaomi", "groq"] as const;

export type OptionalPluginId = (typeof OPTIONAL_PLUGIN_IDS)[number];

export function parseOptionalPluginIds(raw: string | undefined): OptionalPluginId[] {
  const requested = (raw ?? "").split(",").map((part) => part.trim().toLowerCase());
  return OPTIONAL_PLUGIN_IDS.filter((id) => requested.includes(id));
}
