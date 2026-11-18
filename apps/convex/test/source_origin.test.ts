import { describe, expect, it } from "vitest";
import type { SourcePlatformDeclaration } from "@opengroow/agent-templates";
import { originKeyOf } from "../source_origin";

// What the Instagram and TikTok Templates declare (ADR-077): the rules live in
// their manifests, not in this module.
const INSTAGRAM: SourcePlatformDeclaration = {
  name: "Instagram",
  pageHosts: ["instagram.com"],
  originPattern: "^instagram\\.com/(?:[^/]+/)?(?:p|reels?|tv)/([A-Za-z0-9_-]+)",
};
const TIKTOK: SourcePlatformDeclaration = {
  name: "TikTok",
  pageHosts: ["tiktok.com"],
  originPattern: "/(?:video|photo)/(\\d+)",
};

describe("originKeyOf", () => {
  it("gives one key to every link of a post of a declared platform", () => {
    const key = "instagram/DfMymnjh1v0";
    for (const url of [
      "https://www.instagram.com/reel/DfMymnjh1v0/",
      "https://www.instagram.com/reel/DfMymnjh1v0/?psln=eWhsOXoyeXYwZG4z",
      "https://instagram.com/p/DfMymnjh1v0/?cplk=abc",
      "https://www.instagram.com/someone/reel/DfMymnjh1v0/",
      "http://WWW.Instagram.com/reels/DfMymnjh1v0",
    ]) expect(originKeyOf(url, INSTAGRAM)).toBe(key);
  });

  it("tells two posts apart, and the code is case sensitive", () => {
    expect(originKeyOf("https://www.instagram.com/p/AbC/", INSTAGRAM)).not.toBe(originKeyOf("https://www.instagram.com/p/abc/", INSTAGRAM));
  });

  it("matches the subdomains of a page host", () => {
    expect(originKeyOf("https://www.tiktok.com/@.vinogradov_/photo/7665420121472535840", TIKTOK)).toBe("tiktok/7665420121472535840");
    expect(originKeyOf("https://m.tiktok.com/@x/video/7665420121472535840?is_from_webapp=1", TIKTOK)).toBe("tiktok/7665420121472535840");
  });

  it("only applies the pattern on the declared page hosts", () => {
    expect(originKeyOf("https://example.com/p/DfMymnjh1v0", INSTAGRAM)).toBe("example.com/p/DfMymnjh1v0");
    expect(originKeyOf("https://instagram.com.evil.example/p/DfMymnjh1v0", INSTAGRAM)).toBe("instagram.com.evil.example/p/DfMymnjh1v0");
  });

  it("keeps the whole page for a platform page the pattern does not recognise", () => {
    expect(originKeyOf("https://www.instagram.com/someone/", INSTAGRAM)).toBe("instagram.com/someone");
  });

  it("keeps the query of a Source with no declared platform, since it can name the page", () => {
    expect(originKeyOf("https://example.com/serp/?q=shoes")).toBe("example.com/serp?q=shoes");
    expect(originKeyOf("https://www.example.com/serp/?q=boots")).not.toBe(originKeyOf("https://example.com/serp/?q=shoes"));
  });

  it("does not carry a platform's rules without its declaration", () => {
    expect(originKeyOf("https://www.instagram.com/reel/DfMymnjh1v0/?x=1")).toBe("instagram.com/reel/DfMymnjh1v0?x=1");
  });

  it("has no key for an origin that is not a web page", () => {
    expect(originKeyOf("running shoes")).toBeUndefined();
    expect(originKeyOf("ftp://example.com/a")).toBeUndefined();
  });

  it("falls back to the page when the declared pattern is not usable", () => {
    expect(originKeyOf("https://instagram.com/p/x", { ...INSTAGRAM, originPattern: "([" })).toBe("instagram.com/p/x");
  });
});
