import { describe, expect, it } from "vitest";
import { originKeyOf } from "../source_origin";

describe("originKeyOf", () => {
  it("gives one key to every link of an Instagram post", () => {
    const key = "instagram.com/p/DfMymnjh1v0";
    for (const url of [
      "https://www.instagram.com/reel/DfMymnjh1v0/",
      "https://www.instagram.com/reel/DfMymnjh1v0/?psln=eWhsOXoyeXYwZG4z",
      "https://instagram.com/p/DfMymnjh1v0/?cplk=abc",
      "https://www.instagram.com/someone/reel/DfMymnjh1v0/",
      "http://WWW.Instagram.com/reels/DfMymnjh1v0",
    ]) expect(originKeyOf(url)).toBe(key);
  });

  it("tells two Instagram posts apart, and the code is case sensitive", () => {
    expect(originKeyOf("https://www.instagram.com/p/AbC/")).not.toBe(originKeyOf("https://www.instagram.com/p/abc/"));
  });

  it("gives one key to every link of a TikTok post", () => {
    expect(originKeyOf("https://www.tiktok.com/@.vinogradov_/photo/7665420121472535840")).toBe("tiktok.com/7665420121472535840");
    expect(originKeyOf("https://www.tiktok.com/@x/video/7665420121472535840?is_from_webapp=1")).toBe("tiktok.com/7665420121472535840");
  });

  it("keeps the query of any other site, since it can name the page", () => {
    expect(originKeyOf("https://example.com/serp/?q=shoes")).toBe("example.com/serp?q=shoes");
    expect(originKeyOf("https://www.example.com/serp/?q=boots")).not.toBe(originKeyOf("https://example.com/serp/?q=shoes"));
  });

  it("has no key for an origin that is not a web page", () => {
    expect(originKeyOf("running shoes")).toBeUndefined();
    expect(originKeyOf("ftp://example.com/a")).toBeUndefined();
  });
});
