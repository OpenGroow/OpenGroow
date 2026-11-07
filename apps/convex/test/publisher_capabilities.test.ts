import { describe, expect, it } from "vitest";
import { capabilityIn, parseCapabilities } from "@opengroow/publisher-sdk";
import { postizPlugin } from "./postiz-reference/src/index";

// The capabilities are the installed package's data (ADR-072); the core reads them with `capabilityIn`.
const capabilityOf = (service: string | undefined, kind: string) => capabilityIn(postizPlugin.capabilities, service, kind);

describe("capabilities of the Postiz package", () => {
  it("reads confirmed support", () => {
    expect(capabilityOf("instagram", "carousel")).toEqual({ level: "supported" });
  });
  it("refuses with a clear reason", () => {
    expect(capabilityOf("youtube", "image").level).toBe("unsupported");
    expect(capabilityOf("youtube", "image").reason).toMatch(/^YouTube cannot publish an image/);
  });
  it("is uncertain for unconfirmed entries, unknown platforms and a Publisher with no installed package", () => {
    expect(capabilityOf("pinterest", "video").level).toBe("uncertain");
    expect(capabilityOf("mastodon", "video").level).toBe("uncertain");
    expect(capabilityOf(undefined, "video").level).toBe("uncertain");
    expect(capabilityIn(undefined, "instagram", "video").level).toBe("uncertain");
  });
});

describe("parseCapabilities", () => {
  it("rejects a bad schemaVersion or level", () => {
    expect(() => parseCapabilities({ schemaVersion: 2, adapter: "x", platforms: {} })).toThrow(/schemaVersion/);
    expect(() => parseCapabilities({ schemaVersion: 1, adapter: "x", platforms: { a: { video: "yes" } } })).toThrow(/platforms.a.video/);
  });
});
