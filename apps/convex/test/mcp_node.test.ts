import { describe, expect, it, vi, afterEach } from "vitest";
import { callMcpTool } from "../mcp_node";

const URL = "https://article-mcp.test/mcp";

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

function sseResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: (k: string) => (k === "content-type" ? "text/event-stream" : null) },
    text: async () => `event: message\ndata: ${JSON.stringify(body)}\n\n`,
    json: async () => {
      throw new Error("body is not JSON");
    },
  };
}

function stubFetch(response: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const successBody = {
  result: { content: [{ type: "text", text: JSON.stringify({ status: "ok" }) }] },
};

describe("callMcpTool", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses the tool result from a plain JSON response", async () => {
    stubFetch(jsonResponse(successBody));
    const result = await callMcpTool(URL, "publish_article", { articleId: "a1" });
    expect(result).toEqual({ status: "ok" });
  });

  it("parses the tool result from a text/event-stream (SSE) response", async () => {
    stubFetch(sseResponse(successBody));
    const result = await callMcpTool(URL, "publish_article", { articleId: "a1" });
    expect(result).toEqual({ status: "ok" });
  });

  it("sends the JSON-RPC tools/call envelope with merged headers", async () => {
    const fetchMock = stubFetch(jsonResponse(successBody));
    await callMcpTool(URL, "publish_article", { articleId: "a1" }, {
      headers: { Authorization: "Bearer k" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      URL,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer k",
        }),
        body: expect.stringContaining('"name":"publish_article"'),
      }),
    );
  });

  it("throws on a non-ok HTTP response", async () => {
    stubFetch(jsonResponse({}, false, 500, "Internal Server Error"));
    await expect(callMcpTool(URL, "publish_article", {})).rejects.toThrow(/500 Internal Server Error/);
  });

  it("throws on a JSON-RPC error envelope", async () => {
    stubFetch(jsonResponse({ error: { message: "boom" } }));
    await expect(callMcpTool(URL, "publish_article", {})).rejects.toThrow(/boom/);
  });

  it("throws when the tool result is flagged isError", async () => {
    stubFetch(
      jsonResponse({ result: { isError: true, content: [{ type: "text", text: "not allowed" }] } }),
    );
    await expect(callMcpTool(URL, "publish_article", {})).rejects.toThrow(/not allowed/);
  });
});
