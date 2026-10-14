import { afterEach, describe, expect, it, vi } from "vitest";
import { getPublicUrls } from "../src/lib/public-urls";

describe("getPublicUrls", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the URLs from the runtime environment on every call", () => {
    vi.stubEnv("PUBLIC_CONVEX_URL", "https://convex.a.example");
    vi.stubEnv("PUBLIC_APP_URL", "https://app.a.example");
    vi.stubEnv("PUBLIC_SEO_MCP_URL", "https://seo.a.example");
    expect(getPublicUrls()).toEqual({
      convexUrl: "https://convex.a.example",
      appUrl: "https://app.a.example",
      seoMcpUrl: "https://seo.a.example"
    });

    vi.stubEnv("PUBLIC_CONVEX_URL", "https://convex.b.example");
    expect(getPublicUrls().convexUrl).toBe("https://convex.b.example");
  });

  it("falls back to DASHBOARD_URL for the app URL", () => {
    vi.stubEnv("PUBLIC_APP_URL", "");
    vi.stubEnv("DASHBOARD_URL", "https://dash.example");
    expect(getPublicUrls().appUrl).toBe("https://dash.example");
  });

  it("falls back to the local self-host defaults", () => {
    vi.stubEnv("PUBLIC_CONVEX_URL", "");
    vi.stubEnv("PUBLIC_APP_URL", "");
    vi.stubEnv("DASHBOARD_URL", "");
    vi.stubEnv("PUBLIC_SEO_MCP_URL", "");
    expect(getPublicUrls()).toEqual({
      convexUrl: "http://127.0.0.1:3210",
      appUrl: "http://localhost:3912",
      seoMcpUrl: "http://127.0.0.1:3500"
    });
  });
});
