const { toErrorMessage } = require("./control-socket-errors");

function createNodeWorkflow({
  fs,
  pendingDevicesPath,
  runGatewayNodeCommand,
  approveGatewayDevicePairing,
  configTimeoutMs,
}) {
  function invalid(error, data = { output: "" }) {
    return { status: 400, body: { ok: false, error, data } };
  }

  function extractPendingDeviceIds(legacyOutput) {
    try {
      const parsed = JSON.parse(legacyOutput || "{}");
      return new Set(
        Object.values(parsed)
          .map((entry) => entry?.deviceId)
          .filter(
            (deviceId) =>
              typeof deviceId === "string" && deviceId.length > 0,
          ),
      );
    } catch {
      return new Set();
    }
  }

  async function removeUnpairedNodes(pairedNodes, pendingDeviceIds = new Set()) {
    const stuck = pairedNodes.filter(
      (node) =>
        node.connected === true &&
        node.approvalState === "unapproved" &&
        Array.isArray(node.caps) &&
        node.caps.length === 0 &&
        !pendingDeviceIds.has(node.nodeId),
    );
    for (const node of stuck) {
      try {
        await runGatewayNodeCommand(
          ["nodes", "remove", "--node", node.nodeId],
          configTimeoutMs,
        );
      } catch {
        // Cleanup is best effort; a reconnect can race with this command.
      }
    }
    return stuck.length;
  }

  function selectStaleNodes(pairedNodes) {
    return pairedNodes.filter(
      (node) => node.connected === false && node.approvalState !== "approved",
    );
  }

  async function readLegacyPending() {
    try {
      return (await fs.readFile(pendingDevicesPath, "utf8")).trim() || "{}";
    } catch (error) {
      if (error?.code === "ENOENT") {
        return "{}";
      }
      throw error;
    }
  }

  async function approve(body = {}) {
    const requestId =
      typeof body.requestId === "string" ? body.requestId.trim() : "";
    if (!requestId) {
      return invalid("requestId is required", { output: "", requestId: "" });
    }

    let output;
    try {
      const result = await runGatewayNodeCommand(
        ["nodes", "approve", requestId],
        configTimeoutMs,
      );
      output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    } catch (error) {
      const message = toErrorMessage(error);
      if (!/unknown requestId/i.test(message)) {
        throw error;
      }
      output = JSON.stringify(
        await approveGatewayDevicePairing(requestId, {
          timeoutMs: configTimeoutMs,
        }),
      );
    }

    return {
      status: 200,
      body: { ok: true, data: { output, requestId } },
    };
  }

  async function pendingList() {
    const legacy = await readLegacyPending();
    const relayRequestIds = [];
    try {
      const listResult = await runGatewayNodeCommand(
        ["nodes", "list", "--json"],
        configTimeoutMs,
      );
      const nodesData = JSON.parse(listResult.stdout);
      const paired = Array.isArray(nodesData.paired) ? nodesData.paired : [];
      await removeUnpairedNodes(paired, extractPendingDeviceIds(legacy));
      const describedRequestIds = await Promise.all(
        paired
          .filter(
            (node) =>
              node.connected === true &&
              node.approvalState === "pending-approval",
          )
          .map(async (node) => {
            try {
              const result = await runGatewayNodeCommand(
                ["nodes", "describe", "--node", node.nodeId],
                configTimeoutMs,
              );
              const match = result.stdout.match(
                /openclaw nodes approve ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
              );
              return match ? match[1] : null;
            } catch {
              return null;
            }
          }),
      );
      relayRequestIds.push(...describedRequestIds.filter(Boolean));
    } catch {
      // Legacy pending data remains useful when the relay is unavailable.
    }
    return {
      status: 200,
      body: { ok: true, data: { legacy, relayRequestIds } },
    };
  }

  async function cleanupStale() {
    const result = await runGatewayNodeCommand(
      ["nodes", "list", "--json"],
      configTimeoutMs,
    );
    let paired = [];
    try {
      const nodes = JSON.parse(result.stdout);
      if (Array.isArray(nodes.paired)) {
        paired = nodes.paired;
      }
    } catch {
      // Malformed list means there is nothing safe to delete.
    }
    const stale = selectStaleNodes(paired);
    for (const node of stale) {
      try {
        await runGatewayNodeCommand(
          ["nodes", "remove", "--node", node.nodeId],
          configTimeoutMs,
        );
      } catch {
        // Best effort, matching the previous cleanup contract.
      }
    }
    return {
      status: 200,
      body: { ok: true, data: { removedCount: stale.length } },
    };
  }

  async function check() {
    const result = await runGatewayNodeCommand(
      ["nodes", "list", "--json"],
      configTimeoutMs,
    );
    let paired = [];
    try {
      const nodes = JSON.parse(result.stdout);
      if (Array.isArray(nodes.paired)) {
        paired = nodes.paired;
      }
    } catch {
      // Treat malformed output as an empty connected set.
    }
    const legacy = await readLegacyPending();
    const removedCount = await removeUnpairedNodes(
      paired,
      extractPendingDeviceIds(legacy),
    );
    const connected = paired.filter(
      (node) =>
        node.connected === true &&
        Array.isArray(node.caps) &&
        node.caps.includes("system"),
    );
    return {
      status: 200,
      body: {
        ok: true,
        data: {
          connectedCount: connected.length,
          nodes: connected.map((node) => ({
            displayName: node.displayName,
            caps: node.caps,
          })),
          repairing: removedCount > 0,
        },
      },
    };
  }

  return { approve, check, cleanupStale, pendingList };
}

module.exports = { createNodeWorkflow };
