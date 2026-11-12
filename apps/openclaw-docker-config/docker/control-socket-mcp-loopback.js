"use strict";

const net = require("node:net");

// OpenClaw's SSRF guard refuses an MCP server whose hostname resolves to a
// private or special-use address. `host.docker.internal` is one (OrbStack
// resolves it to 0.250.250.254), so every MCP server running on the user's
// machine was cut off from Agent sessions. A literal loopback URL is the one
// local form the guard accepts. The Gateway therefore points such servers at
// 127.0.0.1:<port> and relays that port to the host itself, outside the guard.
const HOST_ALIASES = new Set(["host.docker.internal", "localhost", "127.0.0.1"]);
const LOOPBACK_HOST = "127.0.0.1";

/**
 * The loopback form of an MCP server URL that targets the Docker host, with
 * the port to relay, or `null` when the URL targets anything else (a remote
 * server, a TLS endpoint whose certificate names the host, a stdio server).
 */
function hostServerLoopback(rawUrl) {
  if (typeof rawUrl !== "string") return null;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" || !HOST_ALIASES.has(url.hostname)) return null;
  const port = Number(url.port || 80);
  url.hostname = LOOPBACK_HOST;
  return { url: url.toString(), port };
}

/**
 * Rewrites the `url` of every MCP server that targets the Docker host to its
 * loopback form. Returns the rewritten servers and the ports to relay; other
 * servers pass through untouched.
 */
function toLoopbackServers(servers) {
  const rewritten = {};
  const ports = new Set();
  for (const [key, config] of Object.entries(servers ?? {})) {
    const loopback = config && typeof config === "object" ? hostServerLoopback(config.url) : null;
    if (!loopback) {
      rewritten[key] = config;
      continue;
    }
    rewritten[key] = { ...config, url: loopback.url };
    ports.add(loopback.port);
  }
  return { servers: rewritten, ports: Array.from(ports) };
}

/**
 * Opens one TCP relay per port, 127.0.0.1:<port> → <targetHost>:<port>, once.
 * A port the container already uses cannot be relayed: it is reported, not
 * retried, so the MCP probe surfaces it as the session's failure cause.
 */
function createLoopbackRelays(options = {}) {
  const targetHost = options.targetHost ?? process.env.OPENCLAW_MCP_HOST_RELAY_TARGET ?? "host.docker.internal";
  const log = options.log ?? (() => {});
  const createServer = options.createServer ?? ((onConnection) => net.createServer(onConnection));
  const connect = options.connect ?? ((port, host) => net.connect(port, host));
  const relays = new Map();

  function relay(port) {
    if (relays.has(port)) return relays.get(port);
    const ready = new Promise((resolve) => {
      const server = createServer((client) => {
        const upstream = connect(port, targetHost);
        client.pipe(upstream).pipe(client);
        const close = () => {
          client.destroy();
          upstream.destroy();
        };
        client.on("error", close);
        upstream.on("error", close);
      });
      server.once("error", (error) => {
        log(`MCP relay 127.0.0.1:${port} unavailable: ${error.message}`);
        resolve({ port, ok: false, error: error.message });
      });
      server.listen(port, LOOPBACK_HOST, () => {
        log(`MCP relay 127.0.0.1:${port} -> ${targetHost}:${port}`);
        resolve({ port, ok: true });
      });
    });
    relays.set(port, ready);
    return ready;
  }

  return {
    ensure: (ports) => Promise.all(ports.map(relay)),
  };
}

module.exports = { createLoopbackRelays, hostServerLoopback, toLoopbackServers };
