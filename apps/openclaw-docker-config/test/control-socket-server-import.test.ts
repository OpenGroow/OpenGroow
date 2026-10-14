import { Readable } from "node:stream";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

// Spec for #365: "Le routage est importable et invocable sans démarrage
// automatique" — requiring the production module must not create a socket,
// touch the filesystem, or otherwise start listening. Only calling the
// exported `start()` (or running the file directly as the process entrypoint)
// does that.
describe("control-socket-server.js import seam", () => {
  it("can be required without creating the control socket file", () => {
    const socketPath =
      process.env.OPENCLAW_CONTROL_SOCKET_PATH ?? "/home/node/.openclaw/runtime/control.sock";
    expect(existsSync(socketPath)).toBe(false);

    const mod = require("../docker/control-socket-server.js") as {
      handleRequest: (req: unknown, res: unknown) => Promise<void>;
      start: () => Promise<void>;
    };

    expect(typeof mod.handleRequest).toBe("function");
    expect(typeof mod.start).toBe("function");
    expect(existsSync(socketPath)).toBe(false);
  });
});

function fakeRequest(method: string, url: string, rawBody?: string) {
  const req = Readable.from(rawBody !== undefined ? [Buffer.from(rawBody)] : []) as Readable & {
    method: string;
    url: string;
  };
  req.method = method;
  req.url = url;
  return req;
}

function fakeResponse() {
  let statusCode = 0;
  let headers: Record<string, string | number> = {};
  let body = "";
  const res = {
    writeHead(status: number, hdrs: Record<string, string | number>) {
      statusCode = status;
      headers = hdrs;
    },
    end(chunk?: string) {
      if (chunk) body += chunk;
    },
    get statusCode() {
      return statusCode;
    },
    get headers() {
      return headers;
    },
    get body() {
      return body ? JSON.parse(body) : undefined;
    },
  };
  return res;
}

describe("control-socket-server.js handleRequest (real routing, no side effects)", () => {
  const { handleRequest } = require("../docker/control-socket-server.js") as {
    handleRequest: (req: unknown, res: ReturnType<typeof fakeResponse>) => Promise<void>;
  };

  it("responds to GET /health via the real handler", async () => {
    const res = fakeResponse();
    await handleRequest(fakeRequest("GET", "/health"), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("responds 404 for an unknown route via the real handler", async () => {
    const res = fakeResponse();
    await handleRequest(fakeRequest("GET", "/not-a-real-route"), res);
    expect(res.statusCode).toBe(404);
  });

  it("responds 500 for invalid JSON body on a POST route via the real handler", async () => {
    // readJsonBody's JSON.parse throws synchronously and is caught by
    // handleRequest's top-level try/catch, which maps any thrown error to
    // 500 (there's no route-specific 400-for-bad-JSON path in this handler).
    const res = fakeResponse();
    await handleRequest(fakeRequest("POST", "/nodes/approve", "not json"), res);
    expect(res.statusCode).toBe(500);
  });
});
