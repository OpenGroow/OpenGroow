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

  // One `devices list --json` call exposes both gateway approval stages:
  //  - `pending[]`: device pairing (first connect of a node host);
  //  - `paired[].pendingNodeSurface`: capability approval of a paired node.
  async function listPendingApprovals() {
    const empty = { devicePairing: [], nodeSurface: [] };
    try {
      const result = await runGatewayNodeCommand(
        ["devices", "list", "--json"],
        configTimeoutMs,
      );
      const data = JSON.parse(result.stdout);
      const isId = (id) => typeof id === "string" && id.length > 0;
      const isNode = (entry) =>
        entry?.role === "node" ||
        (Array.isArray(entry?.roles) && entry.roles.includes("node"));
      return {
        devicePairing: (Array.isArray(data.pending) ? data.pending : [])
          .filter((entry) => isNode(entry) && isId(entry.requestId))
          .map((entry) => entry.requestId),
        nodeSurface: (Array.isArray(data.paired) ? data.paired : [])
          .map((entry) => entry?.pendingNodeSurface?.requestId)
          .filter(isId),
      };
    } catch {
      // Best effort: older gateways may not expose `devices list`.
      return empty;
    }
  }

  async function approve(body = {}) {
    const requestId =
      typeof body.requestId === "string" ? body.requestId.trim() : "";
    if (!requestId) {
      return invalid("requestId is required", { output: "", requestId: "" });
    }

    // Two distinct gateway stores hold pairing requests: device pairing
    // (first connect of a node host, `devices list`) and node capability
    // approval (`nodes approve`). Route by where the id actually lives
    // instead of reacting to a CLI error message.
    let output;
    if ((await listPendingApprovals()).devicePairing.includes(requestId)) {
      output = JSON.stringify(
        await approveGatewayDevicePairing(requestId, {
          timeoutMs: configTimeoutMs,
        }),
      );
    } else {
      const result = await runGatewayNodeCommand(
        ["nodes", "approve", requestId],
        configTimeoutMs,
      );
      output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
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
    // A device that has not completed its first connect never shows up in
    // `nodes list`: the gateway closes it with 1008 "pairing required" and
    // only records a pending request in the device pairing store.
    const approvals = await listPendingApprovals();
    for (const id of [...approvals.devicePairing, ...approvals.nodeSurface]) {
      if (!relayRequestIds.includes(id)) relayRequestIds.push(id);
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
