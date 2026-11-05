// Per-platform options of a channel, shipped by the plugin as data
// (`channel-options.json`) and shown by the dashboard. They end up in the
// `settings` of the plugin's `publish` request; a value set here overrides the
// plugin's defaults. A platform without options has none.

export type ChannelOption =
  | { key: string; label: string; type: "select"; options: Array<{ value: string; label: string }>; default: string }
  | { key: string; label: string; type: "boolean"; default: boolean }
  | { key: string; label: string; type: "text"; placeholder?: string };

export type ChannelOptionsData = {
  schemaVersion: number;
  adapter: string;
  platforms: Record<string, ChannelOption[]>;
};

export function optionsOfPlatform(data: ChannelOptionsData, service: string | undefined): ChannelOption[] {
  return (service && data.platforms[service]) || [];
}
