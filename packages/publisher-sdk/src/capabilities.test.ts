import { describe, expect, it } from "vitest";
import { parseCapabilities, platformIcon, servesPlatform } from "./capabilities";

const ICON = "data:image/png;base64,iVBORw0KGgo=";
const DATA = parseCapabilities({
  schemaVersion: 1,
  adapter: "postiz",
  platforms: { tiktok: { name: "TikTok", video: "supported", icon: ICON }, pinterest: { name: "Pinterest", image: "supported" } },
});

describe("platform icons and served platforms (ADR-075)", () => {
  it("validates a platform icon like the manifest icon", () => {
    expect(() =>
      parseCapabilities({ schemaVersion: 1, adapter: "x", platforms: { tiktok: { icon: "https://cdn.example.com/tiktok.png" } } }),
    ).toThrow("capabilities.platforms.tiktok.icon must be a png, webp, jpeg or svg data URI");
  });

  it("gives the platform's own icon, else the package icon", () => {
    expect(platformIcon(DATA, "tiktok", "data:image/svg+xml;base64,PHN2Zy8+")).toBe(ICON);
    expect(platformIcon(DATA, "pinterest", "data:image/svg+xml;base64,PHN2Zy8+")).toBe("data:image/svg+xml;base64,PHN2Zy8+");
    expect(platformIcon(DATA, undefined)).toBeUndefined();
  });

  it("serves only the platforms the package declares", () => {
    expect(servesPlatform(DATA, "tiktok")).toBe(true);
    expect(servesPlatform(DATA, "x")).toBe(false);
    expect(servesPlatform(undefined, "tiktok")).toBe(false);
  });
});
