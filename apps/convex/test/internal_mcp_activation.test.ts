import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveMcpServers } from "../project_agents/mcp_servers";
import { withInternalMcpToken } from "../internal_mcp/activation";
import { parseAgentToken } from "../internal_mcp/agent_token";
import { fixtureTemplate } from "./helpers/template_registry.helpers";

// Activation of a Template that declares the Internal MCP (ADR-080): the URL
// is derived from the deployment, and the Agent gets its own token.

const internalTemplate = fixtureTemplate("example/reader", {
  mcpServers: [{ name: "opengroow", transport: "streamable-http", url: "", internal: { tools: ["list_mission_types"] } }],
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Internal MCP URL", () => {
  it("follows the published Convex site port, reached from the runtime through the host", () => {
    vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3299");
    const { servers, activationUrls } = resolveMcpServers(internalTemplate);
    expect(servers.opengroow).toEqual({ transport: "streamable-http", url: "http://host.docker.internal:3299/internal-mcp" });
    expect(activationUrls.opengroow).toBe("http://host.docker.internal:3299/internal-mcp");
  });

  it("uses a public HTTPS site address as is", () => {
    vi.stubEnv("CONVEX_SITE_URL", "https://deployment.example.com/");
    expect(resolveMcpServers(internalTemplate).servers.opengroow.url).toBe("https://deployment.example.com/internal-mcp");
  });

  it("fails clearly when the deployment does not know its site address", () => {
    vi.stubEnv("CONVEX_SITE_URL", "");
    expect(() => resolveMcpServers(internalTemplate)).toThrow(/Internal MCP/);
  });

  it("does not send the declaration to the runtime", () => {
    vi.stubEnv("CONVEX_SITE_URL", "https://deployment.example.com");
    expect(resolveMcpServers(internalTemplate).servers.opengroow).not.toHaveProperty("internal");
  });
});

describe("Agent token at activation", () => {
  it("is generated as the Agent's apiKey, bound to its Project and Template", () => {
    const config = withInternalMcpToken(internalTemplate, "project-a", "example/reader", { other: "kept" });
    expect(config?.other).toBe("kept");
    expect(parseAgentToken(String(config?.apiKey))).toEqual({ instanceId: "project-a", templateId: "example/reader" });
  });

  it("is new at each activation, so deactivating and reactivating rotates it", () => {
    const first = withInternalMcpToken(internalTemplate, "project-a", "example/reader", undefined);
    const second = withInternalMcpToken(internalTemplate, "project-a", "example/reader", first);
    expect(second?.apiKey).not.toBe(first?.apiKey);
  });

  it("leaves a Template without the Internal MCP untouched", () => {
    const config = { apiKey: "user-key" };
    expect(withInternalMcpToken(fixtureTemplate("example/plain"), "project-a", "example/plain", config)).toBe(config);
  });
});
