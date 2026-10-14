"use node";

// Shared client for calling MCP tools over the streamable-http transport via
// JSON-RPC. An MCP server may answer tools/call with either a plain JSON body or a
// text/event-stream (SSE) body, so both paths must be handled. Used by the
// project-agent activation flow and by mission publishing.

type McpToolResponse = {
  result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
  error?: { message?: string };
};

export async function callMcpTool(
  serverUrl: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
  options: { headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<unknown> {
  const response = await fetch(serverUrl, {
    method: "POST",
    signal: options.signal,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...options.headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: toolArgs },
    }),
  });
  if (!response.ok) {
    throw new Error(`MCP call to ${toolName} failed: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  let data: McpToolResponse;
  if (contentType.includes("text/event-stream")) {
    const text = await response.text();
    const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) {
      throw new Error(`MCP call to ${toolName}: no data line in SSE response`);
    }
    const rawData = dataLine.slice("data:".length).trim();
    try {
      data = JSON.parse(rawData) as McpToolResponse;
    } catch {
      throw new Error(`MCP call to ${toolName} failed (SSE): ${rawData}`);
    }
  } else {
    data = (await response.json()) as McpToolResponse;
  }

  if (data.error) {
    throw new Error(`MCP tool error in ${toolName}: ${data.error.message ?? JSON.stringify(data.error)}`);
  }
  const textContent = data.result?.content?.find((c) => c.type === "text");
  if (!textContent?.text) {
    throw new Error(`MCP tool ${toolName} returned no text content`);
  }
  if (data.result?.isError) {
    throw new Error(`MCP tool error in ${toolName}: ${textContent.text}`);
  }
  try {
    return JSON.parse(textContent.text) as unknown;
  } catch {
    throw new Error(`MCP tool ${toolName} returned non-JSON text: ${textContent.text}`);
  }
}
