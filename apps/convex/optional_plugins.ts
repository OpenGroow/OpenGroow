// Optional OpenClaw plugins an Instance offers (#638, #639). The Instances
// install the ones listed in OPENCLAW_OPTIONAL_PLUGINS at start and the
// Dashboard reads the same variable; Convex reads it too so it never probes or
// auto-disables a feature whose plugin is absent.
import { parseOptionalPluginIds, type OptionalPluginId } from "@opengroow/protocol/optional-plugins";
import { env } from "./env";

export function isOptionalPluginEnabled(id: OptionalPluginId): boolean {
  return parseOptionalPluginIds(env.OPENCLAW_OPTIONAL_PLUGINS).includes(id);
}

export const WHATSAPP_PLUGIN_UNAVAILABLE =
  'WhatsApp is not available on this deployment: add "whatsapp" to OPENCLAW_OPTIONAL_PLUGINS.';
