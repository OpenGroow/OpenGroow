// The platforms a Publisher channel can be on, as the Publishers name them
// (ADR-073). A Mission type may limit where its content goes with
// `publish.platforms`; the values are the ones of this list, compared with the
// `channelService` of each channel. Importable from the manifest validator,
// Convex functions and the dashboard.

/**
 * Known platform identifiers: those of the Postiz provider (`capabilities.json`
 * of the Postiz package). A new Publisher or a new platform adds its identifier
 * here; a test pins the reference Postiz capabilities against this list.
 */
export const PLATFORM_IDS = [
  "bluesky",
  "dribbble",
  "facebook",
  "gmb",
  "instagram",
  "instagram-standalone",
  "linkedin",
  "linkedin-page",
  "pinterest",
  "reddit",
  "tiktok",
  "tumblr",
  "wrapcast",
  "x",
  "youtube",
] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

export function isKnownPlatform(value: unknown): value is PlatformId {
  return typeof value === "string" && (PLATFORM_IDS as readonly string[]).includes(value);
}

/** The family of a platform: `instagram-standalone` is `instagram`, `linkedin-page` is `linkedin`. */
export function platformFamily(platform: string): string {
  return platform.split("-")[0];
}

/**
 * The entry of `platforms` a channel belongs to: its own platform as is
 * (`instagram`), else its family (`instagram-standalone` -> `instagram`).
 * Undefined when the channel is on none of them, or its platform is unknown.
 */
export function matchPlatform(platforms: readonly string[], channelPlatform: string | undefined): string | undefined {
  if (!channelPlatform) return undefined;
  if (platforms.includes(channelPlatform)) return channelPlatform;
  const family = platformFamily(channelPlatform);
  return platforms.includes(family) ? family : undefined;
}
