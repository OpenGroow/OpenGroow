import { describe, expect, it } from "vitest";
import { PINNED_SOURCE_RELEASE, PINNED_SOURCE_TEMPLATE_ID } from "./pinned-source.js";
import { OFFICIAL_SCOPE } from "./official-scope.js";
import { isValidGitAsset, isValidGitTag, parseGitHubRepository } from "./git-archive.js";

describe("pinned @opengroow/source release", () => {
  it("is an official Template", () => {
    expect(PINNED_SOURCE_TEMPLATE_ID).toBe(`${OFFICIAL_SCOPE}source`);
  });

  // The digest must be refreshed from the published asset when the release is cut.
  // printed by the export of the Template (`pnpm template:export`) into
  // PINNED_SOURCE_RELEASE. Projects cannot bootstrap their Source agent without it.
  it("carries a real sha256 digest, set when the release is published", () => {
    expect(PINNED_SOURCE_RELEASE.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("names a valid GitHub repository, tag and asset", () => {
    expect(() => parseGitHubRepository(PINNED_SOURCE_RELEASE.repository)).not.toThrow();
    expect(isValidGitTag(PINNED_SOURCE_RELEASE.tag)).toBe(true);
    if (PINNED_SOURCE_RELEASE.asset !== undefined) expect(isValidGitAsset(PINNED_SOURCE_RELEASE.asset)).toBe(true);
  });
});
