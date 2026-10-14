import { describe, expect, it } from "vitest";
import { openClawAgentSlug } from "./openclaw-agent-slug";

/** What OpenClaw accepts as an agent id / folder name. */
const SAFE_SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;

describe("openClawAgentSlug", () => {
  it("keeps today's unscoped Template ids unchanged, so existing Agents keep their OpenClaw id", () => {
    for (const id of ["seo", "social-engagement", "video-demo", "moneyprinterturbo", "visual-social", "openmontage-agent", "hello", "source"]) {
      expect(openClawAgentSlug(id)).toBe(id);
    }
  });

  it("flattens a scoped id into one folder-safe segment", () => {
    expect(openClawAgentSlug("@opengroow/seo")).toBe("opengroow--seo");
    expect(openClawAgentSlug("@alice/shopify-seo")).toBe("alice--shopify-seo");
  });

  it("never yields a path separator, '@', dot segments or uppercase, whatever the id", () => {
    const ids = [
      "@opengroow/seo", "@a/b", "@Alice/Shopify.SEO", "../../etc/passwd", "@scope/../x", "a/b/c",
      "seo agent", "UPPER", "é-accent", "@@x/y", "@x/", "@/y", "-leading", "trailing-", ".hidden", "a..b",
      "@" + "s".repeat(80) + "/" + "n".repeat(80), "x".repeat(200), "main",
    ];
    for (const id of ids) {
      const slug = openClawAgentSlug(id);
      expect(slug, id).toMatch(SAFE_SLUG);
      expect(slug, id).not.toContain("..");
    }
  });

  it("keeps distinct ids distinct, including a scoped id and a look-alike unscoped one", () => {
    const ids = ["@opengroow/seo", "opengroow--seo", "opengroow-seo", "@opengroow-seo/x", "@opengroow/seo.x", "@opengroow/seo-x", "@a--b/c", "@a/b--c", "@OpenGroow/seo"];
    const slugs = ids.map(openClawAgentSlug);
    expect(new Set(slugs).size).toBe(ids.length);
  });

  it("truncates long ids but stays distinct", () => {
    const a = openClawAgentSlug("@scope/" + "n".repeat(100) + "a");
    const b = openClawAgentSlug("@scope/" + "n".repeat(100) + "b");
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(64);
  });

  it("refuses an empty id", () => {
    expect(() => openClawAgentSlug("")).toThrow();
    expect(() => openClawAgentSlug("   ")).toThrow();
  });
});
