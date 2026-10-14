// Optional OpenClaw plugins an Instance offers (issues #638, #639). The same
// OPENCLAW_OPTIONAL_PLUGINS variable that makes the Instance install them at
// start is read here, per request, so the Dashboard hides what is not there.
// Read from a server component (the root layout) and handed to the client
// through OptionalPluginsProvider; nothing is inlined at build time.
import { parseOptionalPluginIds, type OptionalPluginId } from "@opengroow/protocol/optional-plugins";

export type { OptionalPluginId };

export function getOptionalPlugins(): OptionalPluginId[] {
  return parseOptionalPluginIds(process.env.OPENCLAW_OPTIONAL_PLUGINS);
}
