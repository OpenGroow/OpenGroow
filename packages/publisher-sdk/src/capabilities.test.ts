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

describe("required channel options (ADR-075)", async () => {
  const { missingOptions, notConfiguredReason } = await import("./channel-options");
  const OPTIONS = {
    schemaVersion: 1,
    adapter: "github",
    platforms: {
      github: [
        { key: "branch", label: "Branch", type: "text" as const },
        { key: "articleBaseUrl", label: "URL of the articles", type: "text" as const, required: true },
      ],
    },
  };

  it("names the required options a channel has no value for", () => {
    expect(missingOptions(OPTIONS, "github", { articleBaseUrl: "  " }).map((o) => o.key)).toEqual(["articleBaseUrl"]);
    expect(missingOptions(OPTIONS, "github", { articleBaseUrl: "https://a.example/blog" })).toEqual([]);
    expect(missingOptions(undefined, "github", {})).toEqual([]);
    expect(notConfiguredReason(missingOptions(OPTIONS, "github", undefined))).toBe("Set URL of the articles on the Publishers page");
  });
});
