import { describe, expect, it } from "vitest";
import {
  agentInitials,
  agentShortDescription,
  agentTone,
  formatCategory,
} from "@/components/opengroow/agent-presentation";

describe("agentTone", () => {
  it.each([
    ["marketing", "creative"],
    ["social", "engagement"],
    ["system", "research"],
    ["Marketing", "creative"],
    ["demo", "neutral"],
    [undefined, "neutral"],
  ])("maps category %s to %s", (category, tone) => {
    expect(agentTone(category)).toBe(tone);
  });
});

describe("agentInitials", () => {
  it.each([
    ["MoneyPrinterTurbo Agent", "MP"],
    ["Social Engagement Agent", "SE"],
    ["Video Demo Agent", "VD"],
    ["SEO Agent", "SE"],
    ["Source Agent", "SO"],
    ["openmontage-agent", "OP"],
    ["Visual Social Agent", "VS"],
  ])("%s -> %s", (name, initials) => {
    expect(agentInitials(name)).toBe(initials);
  });
});

describe("agentShortDescription", () => {
  it("keys on the slug, so another scope keeps the text", () => {
    expect(agentShortDescription("@opengroow/seo")).toBe("Researches keywords and creates SEO content.");
    expect(agentShortDescription("@acme/SEO")).toBe("Researches keywords and creates SEO content.");
  });

  it("is undefined for unknown and custom agents", () => {
    expect(agentShortDescription("@bob/custom-thing")).toBeUndefined();
  });
});

describe("formatCategory", () => {
  it("capitalises and upper-cases acronyms", () => {
    expect(formatCategory("marketing")).toBe("Marketing");
    expect(formatCategory("seo")).toBe("SEO");
  });
});
