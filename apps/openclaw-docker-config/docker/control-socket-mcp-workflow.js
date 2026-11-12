const { mergeMcpServers, removeMcpServers } = require("./control-socket-mcp");
const { probeMcpServers } = require("./control-socket-mcp-probe");

function createMcpWorkflow(options = {}) {
  const mcpOptions = { homeDir: options.homeDir };
  const probeOptions = { runProbe: options.runProbe };

  async function merge(body = {}) {
    try {
      const result = await mergeMcpServers({ servers: body.servers }, mcpOptions);
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

  return { merge, remove, probe };
}

module.exports = { createMcpWorkflow };
