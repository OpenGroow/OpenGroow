import { afterEach, describe, expect, it } from "vitest";
import { resolveMcpActivationUrl } from "../mcp_activation_url";

describe("resolveMcpActivationUrl", () => {
  const originalIsSelfHost = process.env.IS_SELF_HOST;

  afterEach(() => {
    if (originalIsSelfHost === undefined) delete process.env.IS_SELF_HOST;
    else process.env.IS_SELF_HOST = originalIsSelfHost;
  });

  it("returns activationUrl unchanged outside the self-host stack", () => {
    delete process.env.IS_SELF_HOST;
    const url = resolveMcpActivationUrl({
      activationUrl: "http://localhost:4100/mcp",
      url: "http://host.docker.internal:4100/mcp",
    });
    expect(url).toBe("http://localhost:4100/mcp");
  });

  it("falls back to `url` when activationUrl is absent", () => {
    delete process.env.IS_SELF_HOST;
    const url = resolveMcpActivationUrl({ url: "http://localhost:4000/mcp" });
    expect(url).toBe("http://localhost:4000/mcp");
  });

  // Regression (self-host issue, 2026-07-07): Convex itself runs inside a
  // Docker container in the self-host stack, so `localhost` in a
  // template-authored `activationUrl` resolves to the Convex container, not
  // the host machine running the MCP server — causing "fetch failed" at
  // activation. IS_SELF_HOST=1 (set by docker-compose.yml) must rewrite
  // loopback hosts to `host.docker.internal`.
  it("rewrites localhost to host.docker.internal under IS_SELF_HOST", () => {
    process.env.IS_SELF_HOST = "1";
    const url = resolveMcpActivationUrl({
      activationUrl: "http://localhost:4100/mcp",
      url: "http://host.docker.internal:4100/mcp",
    });
    expect(url).toBe("http://host.docker.internal:4100/mcp");
  });

  it("rewrites 127.0.0.1 to host.docker.internal under IS_SELF_HOST", () => {
    process.env.IS_SELF_HOST = "1";
    const url = resolveMcpActivationUrl({ activationUrl: "http://127.0.0.1:4000/mcp", url: "http://x/mcp" });
    expect(url).toBe("http://host.docker.internal:4000/mcp");
  });

  it("leaves non-loopback hosts untouched under IS_SELF_HOST", () => {
    process.env.IS_SELF_HOST = "1";
    const url = resolveMcpActivationUrl({
      activationUrl: "https://article-mcp.example.com/mcp",
      url: "https://article-mcp.example.com/mcp",
    });
    expect(url).toBe("https://article-mcp.example.com/mcp");
  });

  it("returns the raw string unchanged if it isn't a valid URL", () => {
    process.env.IS_SELF_HOST = "1";
    const url = resolveMcpActivationUrl({ activationUrl: "not-a-url", url: "not-a-url" });
    expect(url).toBe("not-a-url");
  });
});
