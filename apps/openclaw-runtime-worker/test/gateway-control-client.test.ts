import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayControlClient } from "../src/gateway/gateway-control-client";

type RunningServer = {
  socketPath: string;
  close: () => Promise<void>;
};

const runningServers: RunningServer[] = [];

async function withUnixServer(
  handler: http.RequestListener,
): Promise<RunningServer> {
  const tempDir = mkdtempSync(join(tmpdir(), "openclaw-worker-test-"));
  const socketPath = join(tempDir, "control.sock");
  const server = http.createServer(handler);

  await new Promise<void>((resolve, reject) => {
    server.listen(socketPath, () => resolve());
    server.on("error", reject);
  });

  const runningServer = {
    socketPath,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      rmSync(tempDir, { recursive: true, force: true });
    },
  };

  runningServers.push(runningServer);
  return runningServer;
}

afterEach(async () => {
  while (runningServers.length > 0) {
    const server = runningServers.pop();
    if (server) {
      await server.close();
    }
  }
});

describe("GatewayControlClient", () => {
  it("accepts falsy boolean data when ok is true", async () => {
    const server = await withUnixServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, data: false }));
    });

    const client = new GatewayControlClient(server.socketPath);
    await expect(
      client.requestGatewayControl<boolean>("/feature", {}),
    ).resolves.toBe(false);
  });

  it("accepts numeric zero data when ok is true", async () => {
    const server = await withUnixServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, data: 0 }));
    });

    const client = new GatewayControlClient(server.socketPath);
    await expect(
      client.requestGatewayControl<number>("/counter", {}),
    ).resolves.toBe(0);
  });

  it("fails when ok is false", async () => {
    const server = await withUnixServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "boom" }));
    });

    const client = new GatewayControlClient(server.socketPath);
    await expect(client.requestGatewayControl("/broken", {})).rejects.toThrow(
      /boom/,
    );
  });

  it("fails when the gateway returns invalid JSON", async () => {
    const server = await withUnixServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("not-json");
    });

    const client = new GatewayControlClient(server.socketPath);
    await expect(client.requestGatewayControl("/invalid", {})).rejects.toThrow(
      /Invalid JSON/,
    );
  });

  it("applyWhatsAppConfig forwards the enabled flag to /whatsapp/config", async () => {
    let receivedBody = "";
    const server = await withUnixServer((req, res) => {
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        receivedBody += chunk;
      });
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, data: { output: "WhatsApp channel disabled." } }));
      });
    });

    const client = new GatewayControlClient(server.socketPath);
    await client.applyWhatsAppConfig("", false);

    expect(JSON.parse(receivedBody)).toEqual({ phoneNumber: "", enabled: false });
  });
});
