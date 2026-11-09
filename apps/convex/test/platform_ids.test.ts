import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLATFORM_IDS } from "@opengroow/publisher-sdk";

// ADR-073: `publish.platforms` is checked against PLATFORM_IDS, the vocabulary of the Publishers. The
// reference Postiz package names its platforms in `capabilities.json`: both lists must stay the same,
// so a platform Postiz offers can be written in a Template, and a typo cannot.
describe("platform identifiers", () => {
  it("are exactly the platforms of the reference Postiz capabilities", () => {
    const capabilities = JSON.parse(
      readFileSync(new URL("./postiz_reference/data/capabilities.json", import.meta.url), "utf8"),
    ) as { platforms: Record<string, unknown> };
    expect([...PLATFORM_IDS].sort()).toEqual(Object.keys(capabilities.platforms).sort());
  });
});
