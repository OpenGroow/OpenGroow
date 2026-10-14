const { mergeMcpServers, removeMcpServers } = require("./control-socket-mcp");

function createMcpWorkflow(options = {}) {
  const mcpOptions = { homeDir: options.homeDir };

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

  return { merge, remove };
}

module.exports = { createMcpWorkflow };
