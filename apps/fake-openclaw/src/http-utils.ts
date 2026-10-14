import type { IncomingMessage, ServerResponse } from "node:http";

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 1_000_000) {
        const err = new Error("Body too large");
        req.destroy(err);
        reject(err);
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export async function parseJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw.length) return {};
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid payload");
  }
  return parsed as Record<string, unknown>;
}

export function jsonResponse(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ status, ...payload }));
}

export function str(val: unknown): string | undefined {
  return typeof val === "string" ? val : undefined;
}
