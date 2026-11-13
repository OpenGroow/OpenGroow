// Per-platform options of a channel, shipped by the plugin as data
// (`channel-options.json`) and shown by the dashboard. They end up in the
// `settings` of the plugin's `publish` request; a value set here overrides the
// plugin's defaults. A platform without options has none.

export type ChannelOption =
  | { key: string; label: string; type: "select"; options: Array<{ value: string; label: string }>; default: string }
  | { key: string; label: string; type: "boolean"; default: boolean }
  | {
      key: string;
      label: string;
      type: "text";
      /** An example shown in the empty field: never a value the plugin uses. */
      placeholder?: string;
      /** The plugin cannot publish to the channel without it (ADR-075): the channel is "Not configured" until it is set. */
      required?: boolean;
    };

export type ChannelOptionsData = {
  schemaVersion: number;
  adapter: string;
  platforms: Record<string, ChannelOption[]>;
};

export function optionsOfPlatform(data: ChannelOptionsData, service: string | undefined): ChannelOption[] {
  return (service && data.platforms[service]) || [];
}

/** The required options of a channel that have no value in its `settings`: the channel cannot be published to yet. */
export function missingOptions(
  data: ChannelOptionsData | undefined,
  service: string | undefined,
  settings: Record<string, unknown> | undefined,
): ChannelOption[] {
  if (!data) return [];
  return optionsOfPlatform(data, service).filter((option) => {
    if (option.type !== "text" || !option.required) return false;
    const value = settings?.[option.key];
    return typeof value !== "string" || value.trim() === "";
  });
}

/** Why a channel cannot be published to yet, or undefined when its required options are set. */
export function notConfiguredReason(missing: readonly ChannelOption[]): string | undefined {
  return missing.length === 0 ? undefined : `Set ${missing.map((option) => option.label).join(", ")} on the Publishers page`;
}
