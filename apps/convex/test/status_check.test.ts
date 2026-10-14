import { describe, expect, it, vi, afterEach } from "vitest";
import { officialFixtureTemplate } from "./helpers/template_registry.helpers";
import { checkConfigCompleteness } from "../project_agents/status_check";

const seo = await officialFixtureTemplate("@opengroow/seo");

const SEO_CONTRACT = { server: "article-mcp", mcpTool: "get_project_status" };

function jsonResponse(body: unknown, ok = true, status = 200, statusText = "OK") {
  return {
    ok,
    status,
    statusText,
    headers: { get: (k: string) => (k === "content-type" ? "application/json" : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function mcpToolSuccess(payload: unknown) {
  return jsonResponse({ result: { content: [{ type: "text", text: JSON.stringify(payload) }] } });
}

function stubFetch(response: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("checkConfigCompleteness (issue #320, ADR-034)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns outcome: configured when the MCP tool reports configured: true", async () => {
    stubFetch(mcpToolSuccess({ configured: true, dashboardUrl: "https://article-mcp.example/dashboard" }));
    const result = await checkConfigCompleteness(seo, SEO_CONTRACT, "key-1");
    expect(result).toEqual({ outcome: "configured" });
  });

  it("returns outcome: not_configured with the MCP's message/dashboardUrl when configured is false", async () => {
    stubFetch(
      mcpToolSuccess({
        configured: false,
        dashboardUrl: "https://article-mcp.example/dashboard",
        message: "Finish setting up your GitHub publisher",
      }),
    );
    const result = await checkConfigCompleteness(seo, SEO_CONTRACT, "key-1");
    expect(result).toEqual({
      outcome: "not_configured",
      message: "Finish setting up your GitHub publisher",
      dashboardUrl: "https://article-mcp.example/dashboard",
    });
  });

  it("returns outcome: not_configured with undefined message/dashboardUrl when the MCP omits them", async () => {
    stubFetch(mcpToolSuccess({ configured: false }));
    const result = await checkConfigCompleteness(seo, SEO_CONTRACT, "key-1");
    expect(result).toEqual({ outcome: "not_configured", message: undefined, dashboardUrl: undefined });
  });

  it("returns outcome: key_rejected when the MCP call throws (bad auth, unreachable, malformed)", async () => {
    stubFetch(jsonResponse({}, false, 401, "Unauthorized"));
    const result = await checkConfigCompleteness(seo, SEO_CONTRACT, "bad-key");
    expect(result.outcome).toBe("key_rejected");
    if (result.outcome === "key_rejected") {
      expect(result.message).toContain("article-mcp");
    }
  });

  it("sends the frozen apiKey as a Bearer Authorization header", async () => {
    const fetchMock = stubFetch(mcpToolSuccess({ configured: true, dashboardUrl: "https://x" }));
    await checkConfigCompleteness(seo, SEO_CONTRACT, "secret-key");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer secret-key" }),
      }),
    );
  });

  it("throws when the contract's server is not declared in the template's mcpServers", async () => {
    await expect(
      checkConfigCompleteness(seo, { server: "ghost-mcp", mcpTool: "get_project_status" }, "key-1"),
    ).rejects.toThrow(/ghost-mcp/);
  });
});
