import type { IncomingMessage, ServerResponse } from "node:http";
import { parseJsonBody, jsonResponse, str } from "./http-utils.js";

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

  if (method === "POST" && pathname === "/workspace/create") {
    try {
      const body = await parseJsonBody(req);
      const workspaceKey = str(body.workspaceKey);
      const label = str(body.label);
      if (!workspaceKey) {
        jsonResponse(res, 400, { error: "workspaceKey is required" });
        return;
      }
      if (!label) {
        jsonResponse(res, 400, { error: "label is required" });
        return;
      }
      jsonResponse(res, 200, { ok: true, data: { workspaceKey, label } });
    } catch {
      jsonResponse(res, 400, { error: "Invalid payload" });
    }
    return;
  }

  if (method === "POST" && pathname === "/workspace/file/write") {
    try {
      const body = await parseJsonBody(req);
      const workspaceKey = str(body.workspaceKey);
      const filePath = str(body.filePath);
      const content = str(body.content);
      if (!workspaceKey) {
        jsonResponse(res, 400, { error: "workspaceKey is required" });
        return;
      }
      if (!filePath) {
        jsonResponse(res, 400, { error: "filePath is required" });
        return;
      }
      if (content === undefined) {
        jsonResponse(res, 400, { error: "content is required" });
        return;
      }
      jsonResponse(res, 200, { ok: true, data: { workspaceKey, filePath } });
    } catch {
      jsonResponse(res, 400, { error: "Invalid payload" });
    }
    return;
  }

  if (method === "POST" && pathname === "/mcp/servers/merge") {
    try {
      const body = await parseJsonBody(req);
      const servers = body.servers;
      if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
        jsonResponse(res, 400, { error: "servers is required" });
        return;
      }
      const mergedKeys = Object.keys(servers as Record<string, unknown>);
      jsonResponse(res, 200, { ok: true, data: { mergedKeys } });
    } catch {
      jsonResponse(res, 400, { error: "Invalid payload" });
    }
    return;
  }

  if (method === "POST" && pathname === "/mcp/servers/remove") {
    try {
      const body = await parseJsonBody(req);
      const keys = body.keys;
      if (!Array.isArray(keys)) {
        jsonResponse(res, 400, { error: "keys is required" });
        return;
      }
      jsonResponse(res, 200, { ok: true, data: { removedKeys: keys } });
    } catch {
      jsonResponse(res, 400, { error: "Invalid payload" });
    }
    return;
  }
}
