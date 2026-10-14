import { createServer } from "node:http";
import { startOpenClawWs, sendEvent, isConnected } from "./ws-runtime.js";
import { handleRequest as handleAgentRoutes } from "./http-routes.js";
import { readBody } from "./http-utils.js";

const PORT = Number(process.env.OPENCLAW_PORT ?? "18789");

function json(status: number, payload: unknown): string {
  return JSON.stringify({ status, ...(payload as object) });
}

startOpenClawWs();

const server = createServer(async (req, res) => {
  const method = req.method ?? "GET";
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

  if (method === "GET" && pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      json(200, {
        ok: true,
        service: "fake-openclaw",
        wsClient: true,
        wsConnected: isConnected()
      })
    );
    return;
  }

  if (method === "POST" && pathname === "/send-event") {
    try {
      const raw = await readBody(req);
      const parsed = raw.length ? JSON.parse(raw) : {};
      const type = typeof parsed?.type === "string" ? parsed.type : "manual_event";
      const payload = parsed?.payload ?? {};
      const eventId = typeof parsed?.id === "string" ? parsed.id : `evt_${Date.now()}`;
      const ts = typeof parsed?.ts === "number" ? parsed.ts : Date.now();

      const ok = sendEvent({ id: eventId, type, payload, ts });
      if (!ok) {
        res.writeHead(409, { "content-type": "application/json" });
        res.end(json(409, { error: "WS not connected" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(json(200, { ok: true, event: { id: eventId, type, payload, ts } }));
      return;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Invalid payload";
      res.writeHead(400, { "content-type": "application/json" });
      res.end(json(400, { error: message }));
      return;
    }
  }

  await handleAgentRoutes(req, res);
  if (!res.writableEnded) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(json(404, { error: "Not found" }));
  }
});

server.listen(PORT, () => {
  console.log(`[fake-openclaw] listening on http://localhost:${PORT}`);
});
