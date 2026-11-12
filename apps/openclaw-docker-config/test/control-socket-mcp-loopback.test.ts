import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createLoopbackRelays, hostServerLoopback, toLoopbackServers } = require(
  "../docker/control-socket-mcp-loopback.js",
) as {
  createLoopbackRelays: (options: Record<string, unknown>) => {
    ensure: (ports: number[]) => Promise<Array<{ port: number; ok: boolean; error?: string }>>;
  };
  hostServerLoopback: (url: unknown) => { url: string; port: number } | null;
  toLoopbackServers: (servers: Record<string, Record<string, unknown>>) => {
    servers: Record<string, Record<string, unknown>>;
    ports: number[];
  };
};
const { loopbackExistingMcpServers, mergeMcpServers } = require("../docker/control-socket-mcp.js") as {
  loopbackExistingMcpServers: (options: { homeDir: string }) => Promise<{ relayPorts: number[] }>;
  mergeMcpServers: (
    input: { servers: Record<string, Record<string, unknown>> },
    options: { homeDir: string },
  ) => Promise<{ mergedKeys: string[]; relayPorts: number[] }>;
};

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function makeHome(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "opengroow-mcp-loopback-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)));
}

function freePort(): Promise<number> {
  const probe = net.createServer();
  return listen(probe).then((port) => new Promise((resolve) => probe.close(() => resolve(port))));
}

describe("hostServerLoopback", () => {
  it("points a server on the Docker host at the loopback address", () => {
    expect(hostServerLoopback("http://host.docker.internal:4400/mcp")).toEqual({
      url: "http://127.0.0.1:4400/mcp",
      port: 4400,
    });
    expect(hostServerLoopback("http://localhost:4000/mcp")).toEqual({ url: "http://127.0.0.1:4000/mcp", port: 4000 });
    expect(hostServerLoopback("http://host.docker.internal/mcp")).toEqual({ url: "http://127.0.0.1/mcp", port: 80 });
  });

  it("leaves remote, TLS and non-URL servers alone", () => {
    expect(hostServerLoopback("https://mcp.example.com/mcp")).toBeNull();
    expect(hostServerLoopback("https://host.docker.internal:4400/mcp")).toBeNull();
    expect(hostServerLoopback("http://192.168.1.129:4400/mcp")).toBeNull();
    expect(hostServerLoopback(undefined)).toBeNull();
  });

  it("rewrites only the servers on the host and lists each port once", () => {
    const { servers, ports } = toLoopbackServers({
      "enrich-mcp": { url: "http://host.docker.internal:4400/mcp", callTimeout: 120000 },
      "seo-mcp": { url: "http://host.docker.internal:4000/mcp" },
      "seo-mcp-2": { url: "http://localhost:4000/mcp" },
      search: { command: "node", args: ["search.js"] },
    });
    expect(servers["enrich-mcp"]).toEqual({ url: "http://127.0.0.1:4400/mcp", callTimeout: 120000 });
    expect(servers.search).toEqual({ command: "node", args: ["search.js"] });
    expect(ports.sort()).toEqual([4000, 4400]);
  });
});

describe("openclaw.json loopback rewrite", () => {
  it("stores merged host servers with their loopback URL", async () => {
    const homeDir = await makeHome();
    const result = await mergeMcpServers(
      { servers: { "enrich-mcp": { transport: "streamable-http", url: "http://host.docker.internal:4400/mcp" } } },
      { homeDir },
    );
    expect(result).toEqual({ mergedKeys: ["enrich-mcp"], relayPorts: [4400] });
    const config = JSON.parse(await readFile(path.join(homeDir, ".openclaw", "openclaw.json"), "utf8"));
    expect(config.mcp.servers["enrich-mcp"].url).toBe("http://127.0.0.1:4400/mcp");
  });

  it("migrates an existing config and keeps unrelated settings", async () => {
    const homeDir = await makeHome();
    await mkdir(path.join(homeDir, ".openclaw"), { recursive: true });
    await writeFile(
      path.join(homeDir, ".openclaw", "openclaw.json"),
      JSON.stringify({
        gateway: { port: 18789 },
        mcp: { servers: { "seo-mcp": { url: "http://host.docker.internal:4000/mcp" }, remote: { url: "https://x.dev/mcp" } } },
      }),
    );
    expect(await loopbackExistingMcpServers({ homeDir })).toEqual({ relayPorts: [4000] });
    const config = JSON.parse(await readFile(path.join(homeDir, ".openclaw", "openclaw.json"), "utf8"));
    expect(config.gateway).toEqual({ port: 18789 });
    expect(config.mcp.servers["seo-mcp"].url).toBe("http://127.0.0.1:4000/mcp");
    expect(config.mcp.servers.remote.url).toBe("https://x.dev/mcp");
  });

  it("has nothing to relay without a config", async () => {
    expect(await loopbackExistingMcpServers({ homeDir: await makeHome() })).toEqual({ relayPorts: [] });
  });
});

describe("createLoopbackRelays", () => {
  it("relays a loopback port to the host's server, once per port", async () => {
    const upstream = net.createServer((socket) => socket.on("data", (chunk) => socket.end(`echo:${chunk}`)));
    const upstreamPort = await listen(upstream);
    cleanups.push(() => new Promise<void>((resolve) => upstream.close(() => resolve())));

    const servers: net.Server[] = [];
    const relays = createLoopbackRelays({
      createServer: (onConnection: (socket: net.Socket) => void) => {
        const server = net.createServer(onConnection);
        servers.push(server);
        return server;
      },
      // The "host" is this machine: forward to the upstream's own port.
      connect: () => net.connect(upstreamPort, "127.0.0.1"),
    });
    cleanups.push(() => Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r())))).then(() => {}));

    const port = await freePort();
    expect(await relays.ensure([port, port])).toEqual([{ port, ok: true }, { port, ok: true }]);
    expect(servers).toHaveLength(1);

    const reply = await new Promise<string>((resolve, reject) => {
      const client = net.connect(port, "127.0.0.1", () => client.write("ping"));
      let data = "";
      client.on("data", (chunk) => (data += chunk));
      client.on("end", () => resolve(data));
      client.on("error", reject);
    });
    expect(reply).toBe("echo:ping");
  });

  it("reports a port already taken in the container instead of throwing", async () => {
    const taken = net.createServer();
    const port = await listen(taken);
    cleanups.push(() => new Promise<void>((resolve) => taken.close(() => resolve())));

    const [result] = await createLoopbackRelays({}).ensure([port]);
    expect(result).toMatchObject({ port, ok: false });
    expect(result.error).toContain("EADDRINUSE");
  });
});
