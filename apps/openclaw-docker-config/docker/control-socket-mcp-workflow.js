const { loopbackExistingMcpServers, mergeMcpServers, removeMcpServers } = require("./control-socket-mcp");
const { createLoopbackRelays } = require("./control-socket-mcp-loopback");
const { probeMcpServers } = require("./control-socket-mcp-probe");

function createMcpWorkflow(options = {}) {
  const mcpOptions = { homeDir: options.homeDir };
  const probeOptions = { runProbe: options.runProbe };
  const relays = options.relays ?? createLoopbackRelays({ log: options.log });

  // Runs before the OpenClaw Gateway starts (entrypoint.sh): the config it
  // reads already points at the relays, and they are already listening.
  async function start() {
    const { relayPorts } = await loopbackExistingMcpServers(mcpOptions);
    return relays.ensure(relayPorts);
  }

  async function merge(body = {}) {
    try {
      const { mergedKeys, relayPorts } = await mergeMcpServers({ servers: body.servers }, mcpOptions);
      const relayed = await relays.ensure(relayPorts);
      const result = { mergedKeys, relays: relayed };
      return { status: 200, body: { ok: true, data: result } };
    } catch (error) {
      return {
        status: 400,
        body: {
          ok: false,
          error: error instanceof Error ? error.message : "Failed to merge MCP servers",
        },
      };
    }
  }

  async function remove(body = {}) {
    try {
      const result = await removeMcpServers({ keys: body.keys }, mcpOptions);
      return { status: 200, body: { ok: true, data: result } };
    } catch (error) {
      return {
        status: 400,
        body: {
          ok: false,
          error: error instanceof Error ? error.message : "Failed to remove MCP servers",
        },
      };
    }
  }

  // A server that fails its probe is a 200 with `ok: false` in its result:
  // the route worked, the server did not. 400 is kept for a malformed request.
  async function probe(body = {}) {
    try {
      const result = await probeMcpServers({ keys: body.keys, timeoutMs: body.timeoutMs }, probeOptions);
      return { status: 200, body: { ok: true, data: result } };
    } catch (error) {
      return {
        status: 400,
        body: {
          ok: false,
          error: error instanceof Error ? error.message : "Failed to probe MCP servers",
        },
      };
    }
  }

  return { start, merge, remove, probe };
}

module.exports = { createMcpWorkflow };
