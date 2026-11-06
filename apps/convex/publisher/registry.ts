// Plugin registry of the Publisher core (ADR-070). Maps a Publisher's `adapter`
// id to its plugin: an isolated module of this monorepo that owns all knowledge
// of the external service. The core never branches on a service or platform.
// Importable from Convex functions and from the dashboard.

import { optionsOfPlatform, type ChannelOption, type PublisherPlugin } from "@opengroow/publisher-sdk";
import { postizPlugin } from "@opengroow/publisher-postiz";

const PLUGINS: readonly PublisherPlugin[] = [postizPlugin];

export const PUBLISHER_ADAPTER_IDS = PLUGINS.map((p) => p.id);

/** The plugin of a Publisher's adapter id; throws for an id that is not registered. */
export function pluginFor(id: string): PublisherPlugin {
  const plugin = PLUGINS.find((p) => p.id === id);
  if (!plugin) throw new Error(`Unknown Publisher plugin "${id}"`);
  return plugin;
}

/** The plugin's channel options for a platform (dashboard form); none for an unknown plugin or platform. */
export function channelOptionsOf(adapterId: string, service: string | undefined): ChannelOption[] {
  const plugin = PLUGINS.find((p) => p.id === adapterId);
  return plugin ? optionsOfPlatform(plugin.channelOptions, service) : [];
}
