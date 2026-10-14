import { describe, expect, it } from "vitest";
import { CONTEXT_PROVIDER_NAMES, SOCIAL_ENGAGEMENT_PLATFORMS, validateManifest } from "./index.js";
import { repoPackageTemplate } from "./__fixtures__/templates.js";

describe("context providers (issue #660)", () => {
  const base = repoPackageTemplate("hello").manifest;

  it("refuses a context provider name OpenGroow core does not define, at both levels", () => {
    const atTemplate = validateManifest({ ...base, contextProviders: ["no-such-provider"] });
    expect(atTemplate.ok).toBe(false);
    if (!atTemplate.ok) expect(atTemplate.reason).toMatch(/no-such-provider/);
    const atMissionType = validateManifest({
      ...base,
      missionTypes: [{ type: "x", label: "X", payload: "{}", agentsMd: "x.md", contextProviders: ["no-such-provider"] }],
    });
    expect(atMissionType.ok).toBe(false);
    if (!atMissionType.ok) expect(atMissionType.reason).toMatch(/no-such-provider/);
    expect(validateManifest({ ...base, contextProviders: ["platform-account"] }).ok).toBe(true);
  });

  it("knows the platform-account provider", () => {
    expect(CONTEXT_PROVIDER_NAMES).toContain("platform-account");
  });

  it("platform-account resolves the expected label/config-key pairs (issue #352)", () => {
    expect(SOCIAL_ENGAGEMENT_PLATFORMS).toEqual({
      instagram: { label: "Instagram", accountHandleKey: "accountHandleInstagram" },
      tiktok: { label: "TikTok", accountHandleKey: "accountHandleTiktok" },
    });
  });
});
