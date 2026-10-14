import { afterEach, describe, expect, it } from "vitest";
import {
  buildHmacHeaders,
  buildStringToSign,
  callSignedJsonApi,
  HmacSigner,
  sha256Hex,
  signHmac
} from "@opengroow/hmac";
import {
  createLocalControlServer,
  type LocalControlServer,
  type LocalControlServerOptions
} from "../src/local-control-server.js";
import type { ComposeRunner } from "../src/compose-runner.js";
import type { DockerRunner } from "../src/default-docker-runner.js";
import { loadLocalControlConfig } from "../src/config.js";

const BASE_PORT = 19100;
const KEY_ID = "convex";
const SECRET = "convex-secret";

let currentServer: LocalControlServer | undefined;

afterEach(async () => {
  if (currentServer) {
    await currentServer.close();
    currentServer = undefined;
  }
});

// Every create/remove request also calls syncBrokerKeys(), which — with no
// dockerRunner override — falls through to the real `docker` CLI against
// config's real default brokerContainer, "opengroow-broker-1" (config.ts):
// the exact name of this machine's actual dev-stack broker container.
// Reproduced live 2026-08-18: running this file restarted that real,
// currently-running container (`docker cp` + `docker restart`), and two
// such restarts chained back-to-back (brokerSyncChain serializes them)
// took over vitest's 20s test timeout — the "second create"/"delete after
// two creates" tests below timed out for exactly this reason. Defaulting
// to a no-op mock here makes every test in this file hermetic; a test that
// actually wants to assert on the docker calls opts back in via its own
// `{ dockerRunner }` override, which still wins (spread after the default).
const noopDockerRunner: DockerRunner = async () => ({ code: 0, stdout: "", stderr: "" });

function startServer(
  composeRunner: ComposeRunner,
  extra: Partial<LocalControlServerOptions> = {}
) {
  currentServer = createLocalControlServer({
    port: 0,
    log: false,
    basePort: BASE_PORT,
    composeRunner,
    dockerRunner: noopDockerRunner,
    ...extra
  });
  return currentServer;
}

// Matches @opengroow/hmac's HmacSigner: a bodyless request (empty string
// here — this file has no case that sends a real body) omits the bodyHash
// term entirely rather than hashing the empty string, so it verifies the
// same way a real Convex caller's signature does — see the "accepts a
// bodyless POST/DELETE..." regression test below for the real client.
function signedHeaders(method: string, path: string, body: string) {
  const ts = String(Date.now());
  const nonce = `nonce-${Math.random().toString(36).slice(2)}`;
  const bodyHash = body.length > 0 ? sha256Hex(body) : undefined;
  const signature = signHmac(SECRET, buildStringToSign({ method, path, ts, nonce, bodyHash }));
  return buildHmacHeaders({ keyId: KEY_ID, ts, nonce, signature }, "control");
}

async function post(server: LocalControlServer, path: string, body?: unknown) {
  const rawBody = body === undefined ? "" : JSON.stringify(body);
  const res = await fetch(`http://127.0.0.1:${server.port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...signedHeaders("POST", path, rawBody) },
    body: body === undefined ? undefined : rawBody
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function del(server: LocalControlServer, path: string) {
  const res = await fetch(`http://127.0.0.1:${server.port}${path}`, {
    method: "DELETE",
    headers: signedHeaders("DELETE", path, "")
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function get(server: LocalControlServer, path: string) {
  const res = await fetch(`http://127.0.0.1:${server.port}${path}`, {
    method: "GET",
    headers: signedHeaders("GET", path, "")
  });
  const json = await res.json();
  return { status: res.status, json };
}

describe("HMAC authentication", () => {
  it("rejects an unsigned request without invoking compose (every cross-service HTTP call is signed, docs/HMAC.md)", async () => {
    const calls: Array<{ args: string[] }> = [];
    const composeRunner: ComposeRunner = async (args) => {
      calls.push({ args });
      return { code: 0, stdout: "", stderr: "" };
    };
    const server = startServer(composeRunner);

    const res = await fetch(`http://127.0.0.1:${server.port}/instances`, { method: "POST" });

    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  // Regression: apps/convex/instance_provisioning/local.ts calls this
  // service via @opengroow/hmac's HmacSigner + callSignedJsonApi (the real
  // client, not this file's own hand-rolled signedHeaders() test helper)
  // and never sends a body for POST /instances or DELETE /instances/:id.
  // Both sides of the handshake must agree that "no body" produces the
  // same signature.
  it("accepts a bodyless POST/DELETE signed via the real @opengroow/hmac client Convex uses", async () => {
    const composeRunner: ComposeRunner = async () => ({ code: 0, stdout: "", stderr: "" });
    const server = startServer(composeRunner);
    const signer = new HmacSigner({ keyId: KEY_ID, secret: SECRET, prefix: "control" });
    const baseUrl = `http://127.0.0.1:${server.port}`;

    const created = await callSignedJsonApi({
      signer,
      baseUrl,
      method: "POST",
      path: "/instances",
      timeoutMs: 5000,
      serviceName: "test"
    });
    expect(created.error).toBeUndefined();
    expect(created.id).toMatch(/^local-/);

    const deleted = await callSignedJsonApi({
      signer,
      baseUrl,
      method: "DELETE",
      path: `/instances/${created.id as string}`,
      timeoutMs: 5000,
      serviceName: "test"
    });
    expect(deleted.error).toBeUndefined();
    expect(deleted.removed).toBe(true);
  });
});

describe("POST /instances", () => {
  it("allocates a port, generates credentials, and launches an isolated compose project", async () => {
    const calls: Array<{ args: string[]; env: Record<string, string> }> = [];
    const composeRunner: ComposeRunner = async (args, options) => {
      calls.push({ args, env: options.env });
      return { code: 0, stdout: "", stderr: "" };
    };

    const server = startServer(composeRunner);
    const { status, json } = await post(server, "/instances");

    expect(status).toBe(201);
    expect(json).toMatchObject({
      id: expect.stringMatching(/^local-/),
      port: BASE_PORT,
      keyId: expect.any(String),
      secret: expect.any(String)
    });

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.args).toContain(`openclaw-${json.id}`);
    expect(call.args).toContain("up");
    expect(call.env.OPENCLAW_INSTANCE_ID).toBe(json.id);
    expect(call.env.OPENCLAW_GATEWAY_PORT).toBe(String(BASE_PORT));
    expect(call.env.OPENCLAW_KEY_ID).toBe(json.keyId);
    expect(call.env.OPENCLAW_SECRET).toBe(json.secret);
  });

  it("allocates the next free port for a second instance, checked against already-known instances", async () => {
    const composeRunner: ComposeRunner = async () => ({ code: 0, stdout: "", stderr: "" });
    const server = startServer(composeRunner);

    const first = await post(server, "/instances");
    const second = await post(server, "/instances");

    expect(first.json.port).toBe(BASE_PORT);
    expect(second.json.port).toBe(BASE_PORT + 1);
    expect(second.json.id).not.toBe(first.json.id);
  });

  it("tears down (down -v) whatever was created and returns an error when the up invocation fails", async () => {
    const calls: Array<{ args: string[] }> = [];
    let upCallCount = 0;
    const composeRunner: ComposeRunner = async (args) => {
      calls.push({ args });
      if (args.includes("up")) {
        upCallCount += 1;
        if (upCallCount === 1) {
          return { code: 1, stdout: "", stderr: "image build failed" };
        }
      }
      return { code: 0, stdout: "", stderr: "" };
    };

    const server = startServer(composeRunner);
    const { status, json } = await post(server, "/instances");

    expect(status).toBe(502);
    expect(json.error).toBeTypeOf("string");

    expect(calls).toHaveLength(2);
    expect(calls[0].args).toContain("up");
    expect(calls[1].args).toContain("down");
    // Both invocations target the same instance/project name.
    const projectNameArgOf = (args: string[]) => args[args.indexOf("-p") + 1];
    expect(projectNameArgOf(calls[1].args)).toBe(projectNameArgOf(calls[0].args));

    // The failed instance never occupies a port for a subsequent create.
    const retry = await post(server, "/instances");
    expect(retry.status).toBe(201);
    expect(retry.json.port).toBe(BASE_PORT);
  });
});

describe("DELETE /instances/:id", () => {
  it("tears down containers and volumes for that instance only, leaving other instances untouched", async () => {
    const calls: Array<{ args: string[] }> = [];
    const composeRunner: ComposeRunner = async (args) => {
      calls.push({ args });
      return { code: 0, stdout: "", stderr: "" };
    };

    const server = startServer(composeRunner);
    const first = await post(server, "/instances");
    const second = await post(server, "/instances");
    calls.length = 0;

    const { status, json } = await del(server, `/instances/${first.json.id}`);

    expect(status).toBe(200);
    expect(json).toMatchObject({ id: first.json.id, removed: true });

    expect(calls).toHaveLength(1);
    expect(calls[0].args).toContain(`openclaw-${first.json.id}`);
    expect(calls[0].args).toContain("down");
    expect(calls[0].args).not.toContain(`openclaw-${second.json.id}`);

    // The remaining instance is unaffected: a new create still avoids its port.
    const third = await post(server, "/instances");
    expect(third.json.port).not.toBe(second.json.port);
  });

  it("returns 404 for an unknown instance id and does not invoke compose", async () => {
    const calls: Array<{ args: string[] }> = [];
    const composeRunner: ComposeRunner = async (args) => {
      calls.push({ args });
      return { code: 0, stdout: "", stderr: "" };
    };

    const server = startServer(composeRunner);
    const { status, json } = await del(server, "/instances/local-does-not-exist");

    expect(status).toBe(404);
    expect(json.error).toBeTypeOf("string");
    expect(calls).toHaveLength(0);
  });
});

// Broker key propagation (issue #303's Implementation Decisions, wired in
// issue #307): create/remove regenerates the broker's OpenClaw-keys file to
// cover every currently known instance and restarts the broker container —
// no new broker admin/hot-register endpoint.
describe("broker key sync", () => {
  const passingComposeRunner: ComposeRunner = async () => ({ code: 0, stdout: "", stderr: "" });

  it("syncs the broker's OpenClaw-keys after a successful create, covering every known instance", async () => {
    const dockerCalls: string[][] = [];
    let writtenKeys: unknown;
    const dockerRunner: DockerRunner = async (args) => {
      dockerCalls.push(args);
      if (args[0] === "cp") {
        const { readFileSync } = await import("node:fs");
        writtenKeys = JSON.parse(readFileSync(args[1], "utf8"));
      }
      return { code: 0, stdout: "", stderr: "" };
    };

    const server = startServer(passingComposeRunner, { dockerRunner });
    const { json } = await post(server, "/instances");

    expect(dockerCalls).toHaveLength(2);
    expect(dockerCalls[0][0]).toBe("cp");
    expect(dockerCalls[1]).toEqual(["restart", "opengroow-broker-1"]);
    expect(writtenKeys).toEqual({ [json.keyId]: { openClawId: json.id, secret: json.secret } });
  });

  it("syncs the broker's OpenClaw-keys after a successful remove, excluding the removed instance", async () => {
    const dockerCalls: string[][] = [];
    let writtenKeys: unknown;
    const dockerRunner: DockerRunner = async (args) => {
      dockerCalls.push(args);
      if (args[0] === "cp") {
        const { readFileSync } = await import("node:fs");
        writtenKeys = JSON.parse(readFileSync(args[1], "utf8"));
      }
      return { code: 0, stdout: "", stderr: "" };
    };

    const server = startServer(passingComposeRunner, { dockerRunner });
    const first = await post(server, "/instances");
    const second = await post(server, "/instances");
    dockerCalls.length = 0;

    await del(server, `/instances/${first.json.id}`);

    expect(dockerCalls).toHaveLength(2);
    expect(writtenKeys).toEqual({
      [second.json.keyId]: { openClawId: second.json.id, secret: second.json.secret }
    });
  });

  it("does not sync (or invoke compose) when create fails, and still returns the create error", async () => {
    const composeRunner: ComposeRunner = async () => ({ code: 1, stdout: "", stderr: "boom" });
    const dockerCalls: string[][] = [];
    const dockerRunner: DockerRunner = async (args) => {
      dockerCalls.push(args);
      return { code: 0, stdout: "", stderr: "" };
    };

    const server = startServer(composeRunner, { dockerRunner });
    const { status } = await post(server, "/instances");

    expect(status).toBe(502);
    expect(dockerCalls).toHaveLength(0);
  });

  it("surfaces a broker sync failure as a warning without failing the create response", async () => {
    const dockerRunner: DockerRunner = async (args) => {
      if (args[0] === "cp") {
        return { code: 1, stdout: "", stderr: "no such container" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };

    const server = startServer(passingComposeRunner, { dockerRunner });
    const { status, json } = await post(server, "/instances");

    expect(status).toBe(201);
    expect(json.id).toMatch(/^local-/);
    expect(json.brokerSyncError).toBeTypeOf("string");
  });

  // Regression test for the "openclaw offline" bug: a restart of this
  // service used to reseed its in-memory registry (server.ts's
  // discoverExistingInstances loop) without ever re-syncing the broker's
  // on-disk keys file to match — so any instance created under a prior
  // process incarnation stayed permanently missing from the broker's key
  // set (silently rejecting its runtime-worker's connection) until the next
  // unrelated create/remove call happened to overwrite the file again.
  // server.ts now calls the exposed `syncBrokerKeys()` right after reseeding.
  it("exposes syncBrokerKeys so a registry reseeded directly (not via POST /instances) can still be pushed to the broker", async () => {
    let writtenKeys: unknown;
    const dockerRunner: DockerRunner = async (args) => {
      if (args[0] === "cp") {
        const { readFileSync } = await import("node:fs");
        writtenKeys = JSON.parse(readFileSync(args[1], "utf8"));
      }
      return { code: 0, stdout: "", stderr: "" };
    };

    const server = startServer(passingComposeRunner, { dockerRunner });
    // Mirrors server.ts's discoverExistingInstances reseed loop, which adds
    // directly to the registry rather than going through POST /instances.
    server.registry.add({ id: "local-abc", port: 19100, keyId: "key-abc", secret: "secret-abc", createdAt: "t1" });
    server.registry.add({ id: "local-def", port: 19101, keyId: "key-def", secret: "secret-def", createdAt: "t2" });

    const { brokerSyncError } = await server.syncBrokerKeys();

    expect(brokerSyncError).toBeUndefined();
    expect(writtenKeys).toEqual({
      "key-abc": { openClawId: "local-abc", secret: "secret-abc" },
      "key-def": { openClawId: "local-def", secret: "secret-def" }
    });
  });
});

describe("GET /instances", () => {
  it("lists every known instance as a job payload keyed by its allocated port", async () => {
    const composeRunner: ComposeRunner = async () => ({ code: 0, stdout: "", stderr: "" });
    const server = startServer(composeRunner);
    const first = await post(server, "/instances");
    const second = await post(server, "/instances");

    const { status, json } = await get(server, "/instances");

    expect(status).toBe(200);
    expect(json.jobs).toHaveLength(2);
    expect(json.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.json.id, openclaw: expect.objectContaining({ serverId: first.json.port }) }),
        expect.objectContaining({ id: second.json.id, openclaw: expect.objectContaining({ serverId: second.json.port }) })
      ])
    );
  });

  it("rejects an unsigned request", async () => {
    const composeRunner: ComposeRunner = async () => ({ code: 0, stdout: "", stderr: "" });
    const server = startServer(composeRunner);

    const res = await fetch(`http://127.0.0.1:${server.port}/instances`, { method: "GET" });

    expect(res.status).toBe(401);
  });
});

describe("GET /instances/:id", () => {
  it("returns the single job payload for a known instance", async () => {
    const composeRunner: ComposeRunner = async () => ({ code: 0, stdout: "", stderr: "" });
    const server = startServer(composeRunner);
    const created = await post(server, "/instances");

    const { status, json } = await get(server, `/instances/${created.json.id}`);

    expect(status).toBe(200);
    expect(json.job).toMatchObject({
      id: created.json.id,
      openclaw: { serverId: created.json.port, openClawKeyId: created.json.keyId }
    });
  });

  it("returns 404 for an unknown instance id", async () => {
    const composeRunner: ComposeRunner = async () => ({ code: 0, stdout: "", stderr: "" });
    const server = startServer(composeRunner);

    const { status, json } = await get(server, "/instances/local-does-not-exist");

    expect(status).toBe(404);
    expect(json.error).toBeTypeOf("string");
  });
});

describe("POST /instances/logs/openclaw", () => {
  it("runs docker compose logs scoped to the instance matching the given port", async () => {
    const calls: Array<{ args: string[] }> = [];
    const composeRunner: ComposeRunner = async (args) => {
      calls.push({ args });
      if (args.includes("logs")) {
        return { code: 0, stdout: "gateway log line\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    const server = startServer(composeRunner);
    const created = await post(server, "/instances");
    calls.length = 0;

    const { status, json } = await post(server, "/instances/logs/openclaw", {
      port: created.json.port,
      tail: 50,
      service: "openclaw-gateway"
    });

    expect(status).toBe(200);
    expect(json.output).toBe("gateway log line\n");
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toContain(`openclaw-${created.json.id}`);
    expect(calls[0].args).toContain("logs");
    expect(calls[0].args).toContain("--tail");
    expect(calls[0].args).toContain("50");
    expect(calls[0].args).toContain("openclaw-gateway");
  });

  it("returns 400 when no matching instance port is known", async () => {
    const composeRunner: ComposeRunner = async () => ({ code: 0, stdout: "", stderr: "" });
    const server = startServer(composeRunner);

    const { status, json } = await post(server, "/instances/logs/openclaw", { tail: 50 });

    expect(status).toBe(400);
    expect(json.error).toBeTypeOf("string");
  });

  it("returns 404 when the given port has no known instance", async () => {
    const composeRunner: ComposeRunner = async () => ({ code: 0, stdout: "", stderr: "" });
    const server = startServer(composeRunner);

    const { status, json } = await post(server, "/instances/logs/openclaw", { port: 39999 });

    expect(status).toBe(404);
    expect(json.error).toBeTypeOf("string");
  });
});

describe("POST /instances/logs/broker", () => {
  it("runs plain docker logs against the shared broker container, ignoring any port", async () => {
    const calls: Array<{ args: string[] }> = [];
    const composeRunner: ComposeRunner = async () => ({ code: 0, stdout: "", stderr: "" });
    const dockerRunner: DockerRunner = async (args) => {
      calls.push({ args });
      return { code: 0, stdout: "broker log line\n", stderr: "" };
    };
    const server = startServer(composeRunner, { dockerRunner });

    const { status, json } = await post(server, "/instances/logs/broker", { tail: 300 });

    expect(status).toBe(200);
    expect(json.output).toBe("broker log line\n");
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(["logs", "--tail", "300", "opengroow-broker-1"]);
  });

  it("surfaces a 502 when the docker command fails", async () => {
    const composeRunner: ComposeRunner = async () => ({ code: 0, stdout: "", stderr: "" });
    const dockerRunner: DockerRunner = async () => ({
      code: 1,
      stdout: "",
      stderr: "no such container"
    });
    const server = startServer(composeRunner, { dockerRunner });

    const { status, json } = await post(server, "/instances/logs/broker", {});

    expect(status).toBe(502);
    expect(json.error).toBeTypeOf("string");
  });
});

describe("POST /instances/status/openclaw", () => {
  it("runs docker compose ps scoped to the instance matching the given port", async () => {
    const calls: Array<{ args: string[] }> = [];
    const composeRunner: ComposeRunner = async (args) => {
      calls.push({ args });
      if (args.includes("ps")) {
        return { code: 0, stdout: "openclaw-gateway  running\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    const server = startServer(composeRunner);
    const created = await post(server, "/instances");
    calls.length = 0;

    const { status, json } = await post(server, "/instances/status/openclaw", {
      port: created.json.port
    });

    expect(status).toBe(200);
    expect(json.output).toBe("openclaw-gateway  running\n");
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toContain(`openclaw-${created.json.id}`);
    expect(calls[0].args).toContain("ps");
  });

  it("returns 400 when no matching instance port is known", async () => {
    const composeRunner: ComposeRunner = async () => ({ code: 0, stdout: "", stderr: "" });
    const server = startServer(composeRunner);

    const { status, json } = await post(server, "/instances/status/openclaw", {});

    expect(status).toBe(400);
    expect(json.error).toBeTypeOf("string");
  });

  it("returns 404 when the given port has no known instance", async () => {
    const composeRunner: ComposeRunner = async () => ({ code: 0, stdout: "", stderr: "" });
    const server = startServer(composeRunner);

    const { status, json } = await post(server, "/instances/status/openclaw", { port: 39999 });

    expect(status).toBe(404);
    expect(json.error).toBeTypeOf("string");
  });
});

describe("POST /instances/status/broker", () => {
  it("runs plain docker ps filtered to the shared broker container", async () => {
    const calls: Array<{ args: string[] }> = [];
    const composeRunner: ComposeRunner = async () => ({ code: 0, stdout: "", stderr: "" });
    const dockerRunner: DockerRunner = async (args) => {
      calls.push({ args });
      return { code: 0, stdout: "opengroow-broker-1  Up\n", stderr: "" };
    };
    const server = startServer(composeRunner, { dockerRunner });

    const { status, json } = await post(server, "/instances/status/broker", {});

    expect(status).toBe(200);
    expect(json.output).toBe("opengroow-broker-1  Up\n");
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(["ps", "--filter", "name=opengroow-broker-1"]);
  });
});

describe("explicit keys required (docker.sock container)", () => {
  const base = { port: 0, log: false, dockerRunner: noopDockerRunner } as const;
  const strict = (keysRaw?: string) => ({
    ...loadLocalControlConfig(),
    requireExplicitKeys: true,
    keysRaw
  });

  it("refuses to start with no keys when explicit keys are required", () => {
    expect(() => createLocalControlServer({ ...base, config: strict(undefined) })).toThrow(
      /OPENCLAW_LOCAL_CONTROL_KEYS is required/
    );
  });

  it("refuses the well-known default secret when explicit keys are required", () => {
    const raw = JSON.stringify({ convex: { secret: "convex-secret" } });
    expect(() => createLocalControlServer({ ...base, config: strict(raw) })).toThrow(/default/);
  });

  it("accepts a generated secret when explicit keys are required", () => {
    const raw = JSON.stringify({ convex: { secret: "a".repeat(48) } });
    currentServer = createLocalControlServer({ ...base, config: strict(raw) });
    expect(currentServer.port).toBeGreaterThan(0);
  });
});
