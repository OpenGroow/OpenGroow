import { httpAction } from "../_generated/server.js";
import { internal } from "../_generated/api.js";
import type { InternalMcpOutcome } from "./server.js";

/**
 * The Internal MCP route (ADR-080): the MCP protocol over a stateless
 * streamable HTTP endpoint with plain JSON responses (no session, no SSE).
 * It only speaks JSON-RPC; `internal_mcp/server.ts` decides what is allowed.
 */
const JSON_HEADERS = { "Content-Type": "application/json" };
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type JsonRpcRequest = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const success = (id: unknown, result: unknown) => reply(200, { jsonrpc: "2.0", id, result });
const failure = (status: number, id: unknown, code: number, message: string) =>
  reply(status, { jsonrpc: "2.0", id: id ?? null, error: { code, message } });

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function describeOutcome(id: unknown, outcome: InternalMcpOutcome): Response {
  switch (outcome.kind) {
    case "refused":
      return failure(outcome.status, id, -32001, outcome.message);
    case "tools":
      return success(id, { tools: outcome.tools });
    case "unknown_tool":
      return failure(200, id, -32602, `Unknown tool: ${outcome.name}`);
    case "tool_result":
      return success(id, { content: [{ type: "text", text: outcome.text }], isError: outcome.isError });
    case "ok":
      return success(id, {});
  }
}

export const internalMcpHandler = httpAction(async (ctx, request) => {
  let message: JsonRpcRequest;
  try {
    message = await request.json();
  } catch {
    return failure(400, null, -32700, "Parse error");
  }
  if (typeof message !== "object" || message === null || Array.isArray(message) || typeof message.method !== "string") {
    return failure(400, null, -32600, "Invalid Request: expected one JSON-RPC request");
  }
  const { id, method } = message;
  const params = (typeof message.params === "object" && message.params !== null ? message.params : {}) as Record<string, unknown>;
  const token = bearerToken(request);

  if (method === "initialize") {
    const outcome = await ctx.runQuery(internal.internal_mcp.server.handle, { token, method });
    if (outcome.kind !== "ok") return describeOutcome(id, outcome);
    const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
    return success(id, {
      protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0],
      capabilities: { tools: {} },
      serverInfo: { name: "opengroow", version: "1" },
    });
  }

  if (method === "tools/list" || method === "tools/call") {
    const outcome = await ctx.runQuery(internal.internal_mcp.server.handle, {
      token,
      method,
      ...(method === "tools/call" ? { toolName: typeof params.name === "string" ? params.name : "", toolArguments: params.arguments } : {}),
    });
    return describeOutcome(id, outcome);
  }

  // Notifications carry no id and get no answer; the other methods are not served.
  if (id === undefined) return new Response(null, { status: 202 });
  if (method === "ping") return success(id, {});
  return failure(200, id, -32601, `Method not found: ${method}`);
});

/** A stateless server has no stream to offer a GET (and no session to DELETE). */
export const internalMcpNotAllowed = httpAction(async () => new Response(null, { status: 405, headers: { Allow: "POST" } }));
