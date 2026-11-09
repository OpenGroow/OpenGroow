import { describe, expect, it } from "vitest";
import { capabilityFor } from "./capabilities";
import { isKnownPlatform, matchPlatform, PLATFORM_IDS } from "./platforms";

describe("platforms", () => {
  it("knows its identifiers and nothing else", () => {
    expect(isKnownPlatform("tiktok")).toBe(true);
    expect(isKnownPlatform("tiktkok")).toBe(false);
    expect(isKnownPlatform(undefined)).toBe(false);
    expect(new Set(PLATFORM_IDS).size).toBe(PLATFORM_IDS.length);
  });

  it("matches a channel's platform as is, else by family", () => {
    expect(matchPlatform(["instagram", "tiktok"], "tiktok")).toBe("tiktok");
    expect(matchPlatform(["instagram"], "instagram-standalone")).toBe("instagram");
    expect(matchPlatform(["instagram", "tiktok"], "pinterest")).toBeUndefined();
    expect(matchPlatform(["instagram"], undefined)).toBeUndefined();
  });

  it("limits a channel to the platforms of the Mission type, naming them by their display name", () => {
    const data = { schemaVersion: 1, adapter: "x", platforms: { instagram: { name: "Instagram", carousel: "supported" as const }, tiktok: { name: "TikTok", carousel: "supported" as const }, pinterest: { name: "Pinterest", carousel: "uncertain" as const } } };
    expect(capabilityFor(data, "pinterest", "carousel", ["instagram", "tiktok"])).toEqual({ level: "unsupported", reason: "This Mission type publishes to Instagram and TikTok only" });
    expect(capabilityFor(data, "instagram", "carousel", ["instagram", "tiktok"])).toEqual({ level: "supported" });
    expect(capabilityFor(data, "pinterest", "carousel").level).toBe("uncertain");
  });
});
