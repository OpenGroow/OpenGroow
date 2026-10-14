import { describe, it, expect, vi, afterEach } from "vitest";
import { devActivationDefaults } from "../src/utils/dev-activation-defaults";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("devActivationDefaults", () => {
  // The article and video MCPs now own their Project config end-to-end via
  // their own dashboards (issue #320, ADR-034) — OpenGroow's activation form
  // shrinks to the single apiKey field, so the dev defaults do too.
  it("returns only an apiKey dev default for seo in local development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const values = devActivationDefaults("@opengroow/seo");
    expect(values).toEqual({ apiKey: "" });
  });

  it("returns only an apiKey dev default for video-demo in local development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const values = devActivationDefaults("@opengroow/video-demo");
    expect(values).toEqual({ apiKey: "" });
  });

  it("returns undefined for a template with no configured defaults", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(devActivationDefaults("@opengroow/hello")).toBeUndefined();
  });

  it("returns undefined outside development (production/test) so the form stays empty", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(devActivationDefaults("@opengroow/seo")).toBeUndefined();
    vi.stubEnv("NODE_ENV", "test");
    expect(devActivationDefaults("@opengroow/seo")).toBeUndefined();
  });
});
