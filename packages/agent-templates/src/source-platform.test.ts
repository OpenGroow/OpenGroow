import { describe, it, expect } from "vitest";
import { validateManifest } from "./index.js";
import { findUnknownManifestKey } from "./manifest-keys.js";

// ADR-077: a Source declares its platform, dedupe key and thumbnail.
const ICON = "data:image/svg+xml;base64,PHN2Zy8+";

const PLATFORM = {
  name: "Instagram",
  icon: ICON,
  pageHosts: ["instagram.com"],
  originPattern: "^instagram\\.com/(?:[^/]+/)?(?:p|reels?|tv)/([A-Za-z0-9_-]+)",
  thumbnail: "og-image",
  imageHosts: ["cdninstagram.com", "fbcdn.net"],
  mediaLabels: { video: "Reel" },
};

function manifestWith(platform: unknown) {
  return {
    id: "t",
    name: "T",
    description: "d",
    category: "test",
    mcpServers: [],
    missionTypes: [],
    sources: [
      {
        type: "s",
        label: "S",
        family: "f",
        agentsMd: "sources/s.md",
        analysisSchema: { type: "object", properties: {} },
        ...(platform === undefined ? {} : { platform }),
      },
    ],
  };
}

const reasonFor = (platform: unknown): string | undefined => {
  const result = validateManifest(manifestWith(platform));
  return result.ok ? undefined : result.reason;
};

describe("Source platform declaration", () => {
  it("is optional", () => {
    expect(validateManifest(manifestWith(undefined)).ok).toBe(true);
  });

  it("accepts a full declaration", () => {
    expect(reasonFor(PLATFORM)).toBeUndefined();
  });

  it("accepts a name and page hosts alone", () => {
    expect(reasonFor({ name: "Reddit", pageHosts: ["reddit.com"] })).toBeUndefined();
  });

  it("refuses an unknown key, with its path", () => {
    expect(findUnknownManifestKey(manifestWith({ ...PLATFORM, scrape: true }) as never)).toContain("scrape");
  });

  it("requires a non-empty name", () => {
    expect(reasonFor({ ...PLATFORM, name: "" })).toMatch(/platform\.name/);
  });

  it("requires at least one page host", () => {
    expect(reasonFor({ ...PLATFORM, pageHosts: [] })).toMatch(/pageHosts/);
  });

  it.each(["localhost", "127.0.0.1", "10.0.0.1", "https://instagram.com", "insta gram.com", "instagram.com:8080", "internal", "[::1]"])(
    "refuses the page host %s",
    (host) => {
      expect(reasonFor({ ...PLATFORM, pageHosts: [host] })).toMatch(/pageHosts/);
    },
  );

  it("refuses an image host that is not a domain", () => {
    expect(reasonFor({ ...PLATFORM, imageHosts: ["169.254.169.254"] })).toMatch(/imageHosts/);
  });

  it("requires image hosts when a thumbnail strategy is declared", () => {
    expect(reasonFor({ name: "X", pageHosts: ["x.com"], thumbnail: "og-image" })).toMatch(/imageHosts/);
  });

  it("refuses an unknown thumbnail strategy", () => {
    expect(reasonFor({ ...PLATFORM, thumbnail: "headless-browser" })).toMatch(/thumbnail/);
  });

  it("refuses an icon that is not an image data URI", () => {
    expect(reasonFor({ ...PLATFORM, icon: "https://evil.example/logo.png" })).toMatch(/icon/);
  });

  it("refuses an origin pattern that does not compile", () => {
    expect(reasonFor({ ...PLATFORM, originPattern: "([" })).toMatch(/originPattern/);
  });

  it("refuses an origin pattern without exactly one capture group", () => {
    expect(reasonFor({ ...PLATFORM, originPattern: "^instagram\\.com/p/[a-z]+" })).toMatch(/capture group/);
    expect(reasonFor({ ...PLATFORM, originPattern: "^instagram\\.com/(p)/([a-z]+)" })).toMatch(/capture group/);
  });

  it("refuses a too long origin pattern", () => {
    expect(reasonFor({ ...PLATFORM, originPattern: `(${"a".repeat(300)})` })).toMatch(/originPattern/);
  });

  it("refuses a media label for an unknown media", () => {
    expect(reasonFor({ ...PLATFORM, mediaLabels: { audio: "Podcast" } })).toMatch(/mediaLabels/);
  });
});
