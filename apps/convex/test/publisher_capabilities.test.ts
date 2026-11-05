import { describe, expect, it } from "vitest";
import { capabilityOf, parseCapabilities } from "../publisher/capabilities";

describe("capabilityOf (postiz)", () => {
  it("reads confirmed support", () => {
    expect(capabilityOf("postiz", "instagram", "carousel")).toEqual({ level: "supported" });
  });
  it("refuses with a clear reason", () => {
    expect(capabilityOf("postiz", "youtube", "image").level).toBe("unsupported");
    expect(capabilityOf("postiz", "youtube", "image").reason).toMatch(/^YouTube cannot publish an image/);
  });
  it("is uncertain for unconfirmed entries and for unknown platforms or adapters", () => {
    expect(capabilityOf("postiz", "pinterest", "video").level).toBe("uncertain");
    expect(capabilityOf("postiz", "mastodon", "video").level).toBe("uncertain");
    expect(capabilityOf("other", "instagram", "video").level).toBe("uncertain");
    expect(capabilityOf("postiz", undefined, "video").level).toBe("uncertain");
  });
});

describe("parseCapabilities", () => {
  it("rejects a bad schemaVersion or level", () => {
    expect(() => parseCapabilities({ schemaVersion: 2, adapter: "x", platforms: {} })).toThrow(/schemaVersion/);
    expect(() => parseCapabilities({ schemaVersion: 1, adapter: "x", platforms: { a: { video: "yes" } } })).toThrow(/platforms.a.video/);
  });
});
