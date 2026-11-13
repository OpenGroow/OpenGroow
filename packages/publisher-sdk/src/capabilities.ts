// Channel / content-kind capabilities (ADR-069 amendment, docs/domain/publishing.md).
// Which Publishable kinds a service can carry is a property of the publishing
// service, so it is DATA shipped with the plugin (`capabilities.json`), read
// through this pure module: no network, no per-platform branch in code.
// Importable from Convex functions and from the dashboard.

import { isValidIcon, MAX_ICON_LENGTH } from "./manifest";
import { matchPlatform } from "./platforms";

export const CAPABILITY_KINDS = ["video", "image", "carousel", "article"] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];
export type CapabilityLevel = "supported" | "uncertain" | "unsupported";
export type Capability = { level: CapabilityLevel; reason?: string };

export const CAPABILITIES_SCHEMA_VERSION = 1;

export type PlatformCapabilities = {
  name?: string;
  /** The platform's logo, shipped with the package (a data URI, same rule as the manifest `icon`): the dashboard
   * shows it for the channels of this platform, with no request. Absent: the package icon. */
  icon?: string;
  video?: CapabilityLevel;
  image?: CapabilityLevel;
  carousel?: CapabilityLevel;
  article?: CapabilityLevel;
  reasons?: Partial<Record<CapabilityKind, string>>;
};
export type CapabilitiesData = {
  schemaVersion: number;
  adapter: string;
  source?: string;
  platforms: Record<string, PlatformCapabilities>;
};

const LEVELS: readonly string[] = ["supported", "uncertain", "unsupported"];

/** Validates raw capability data (a JSON file); throws an actionable message. */
export function parseCapabilities(raw: unknown): CapabilitiesData {
  const obj = raw as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("capabilities must be an object");
  if (obj.schemaVersion !== CAPABILITIES_SCHEMA_VERSION) {
    throw new Error(`capabilities.schemaVersion must be ${CAPABILITIES_SCHEMA_VERSION}`);
  }
  if (typeof obj.adapter !== "string" || obj.adapter === "") throw new Error("capabilities.adapter must be a non-empty string");
  const platforms = obj.platforms as Record<string, Record<string, unknown>> | null;
  if (!platforms || typeof platforms !== "object" || Array.isArray(platforms)) throw new Error("capabilities.platforms must be an object");
  for (const [service, entry] of Object.entries(platforms)) {
    if (!entry || typeof entry !== "object") throw new Error(`capabilities.platforms.${service} must be an object`);
    if (entry.icon !== undefined && !isValidIcon(entry.icon)) {
      throw new Error(`capabilities.platforms.${service}.icon must be a png, webp, jpeg or svg data URI of at most ${MAX_ICON_LENGTH} characters`);
    }
    for (const kind of CAPABILITY_KINDS) {
      const level = entry[kind];
      if (level !== undefined && !LEVELS.includes(level as string)) {
        throw new Error(`capabilities.platforms.${service}.${kind} must be one of ${LEVELS.join(", ")}`);
      }
    }
  }
  return obj as unknown as CapabilitiesData;
}

/**
 * Whether the package publishes to `service` at all. A channel of a platform the
 * package does not declare is not offered, and cannot be added (ADR-075).
 */
export function servesPlatform(data: CapabilitiesData | undefined, service: string | undefined): boolean {
  return Boolean(service && data?.platforms[service]);
}

/** The logo of a channel's platform: the one the package ships for it, else the package's own icon. No request. */
export function platformIcon(data: CapabilitiesData | undefined, service: string | undefined, packageIcon?: string): string | undefined {
  return (service ? data?.platforms[service]?.icon : undefined) ?? packageIcon;
}

/** Capability of a channel's service for a Publishable kind. Unknown service or kind: `uncertain`. */
export function capabilityIn(data: CapabilitiesData | undefined, service: string | undefined, kind: string): Capability {
  const entry = service ? data?.platforms[service] : undefined;
  const level = entry?.[kind as CapabilityKind];
  const name = entry?.name ?? service ?? "This channel";
  if (!level || level === "uncertain") {
    return { level: "uncertain", reason: entry?.reasons?.[kind as CapabilityKind] ?? `${name} publishing a ${kind} is not confirmed` };
  }
  if (level === "unsupported") {
    const detail = entry?.reasons?.[kind as CapabilityKind];
    return { level, reason: `${name} cannot publish ${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind}${detail ? ` (${detail})` : ""}` };
  }
  return { level };
}

/**
 * What a channel can carry for a Mission type: `capabilityIn`, after the
 * platforms the Mission type is limited to (`publish.platforms`, ADR-073). A
 * channel on another platform is `unsupported`, with the platforms it can go to
 * named in the reason. Without `platforms`, only the capability of the service.
 */
export function capabilityFor(
  data: CapabilitiesData | undefined,
  service: string | undefined,
  kind: string,
  platforms?: readonly string[],
  /** The platforms the content was actually made for (the keys of its `variants`, when it has no default media). */
  madeFor?: readonly string[],
): Capability {
  if (platforms && platforms.length > 0 && !matchPlatform(platforms, service)) {
    const names = platforms.map((platform) => data?.platforms[platform]?.name ?? platform);
    return { level: "unsupported", reason: `This Mission type publishes to ${names.join(" and ")} only` };
  }
  if (madeFor && madeFor.length > 0 && !matchPlatform(madeFor, service)) {
    const names = madeFor.map((platform) => data?.platforms[platform]?.name ?? platform);
    return { level: "unsupported", reason: `This ${kind} was made for ${names.join(" and ")} only` };
  }
  return capabilityIn(data, service, kind);
}
