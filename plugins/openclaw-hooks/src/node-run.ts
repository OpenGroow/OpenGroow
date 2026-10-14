/**
 * Runs a shell command on a paired node host through the `system.run` node
 * command — the same primitive OpenClaw's own `exec` tool with `host: "node"`
 * dispatches, just invoked from trusted plugin code instead of from the model.
 *
 * Everything here mirrors OpenClaw's `buildNodeShellCommand` /
 * `buildNodeSystemRunInvoke` / `formatNodeRunToolResult` trio, because the node
 * host validates the payload shape and silently no-ops on anything else.
 */

/** Minimal shape this module needs from `OpenClawPluginApi.runtime.nodes`. */
export type NodesRuntime = {
  list: (params?: { connected?: boolean }) => Promise<{
    nodes: Array<{ nodeId: string; displayName?: string }>;
  }>;
  invoke: (params: { nodeId: string; command: string; params?: unknown }) => Promise<unknown>;
};

export type NodeRunResult = {
  stdout: string;
  exitCode: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * `node.invoke` answers with an `{ ok, payload | payloadJSON, error }` envelope;
 * the `system.run` result itself lives in the payload. Tolerate a bare payload
 * too, since `runtime.nodes.invoke` is typed `Promise<unknown>`.
 */
function unwrapInvokePayload(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) {
    throw new Error(`node invoke returned a non-object result (${typeof raw})`);
  }
  if (raw.ok === false) {
    throw new Error(`node invoke failed: ${JSON.stringify(raw.error ?? null)}`);
  }
  if (typeof raw.payloadJSON === "string") {
    const parsed: unknown = JSON.parse(raw.payloadJSON);
    if (!isRecord(parsed)) {
      throw new Error("node invoke payloadJSON is not an object");
    }
    return parsed;
  }
  if (isRecord(raw.payload)) {
    return raw.payload;
  }
  return raw;
}

/**
 * Quotes a value for POSIX `sh`. `JSON.stringify` is not a substitute: inside
 * double quotes `sh` still expands `$`, backticks and backslashes, and the
 * paths here are built from ids scraped out of a model-authored command string.
 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Resolves a paired-node display name (e.g. "My Computer", as passed to the
 * `exec` tool's `node` param) to the node id `runtime.nodes.invoke` needs.
 * An empty query resolves to the only paired node, matching what `exec` does
 * when the agent omits `node`.
 */
async function resolveNodeId(nodes: NodesRuntime, nodeQuery: string): Promise<string> {
  const { nodes: paired } = await nodes.list();
  if (!nodeQuery) {
    if (paired.length !== 1) {
      throw new Error(`no node was named and ${paired.length} nodes are paired`);
    }
    return paired[0]!.nodeId;
  }
  const match = paired.find((node) => node.nodeId === nodeQuery || node.displayName === nodeQuery);
  if (!match) {
    throw new Error(`no paired node matches "${nodeQuery}"`);
  }
  return match.nodeId;
}

/**
 * Runs `command` on the paired node host and returns its stdout, throwing on
 * any non-zero exit. `params.command` **must** be an argv array: the node host
 * does `Array.isArray(params.command) ? params.command : []`, so a plain string
 * is coerced to an empty argv and the command silently never runs.
 *
 * `cwd` is deliberately omitted so relative paths resolve against the node
 * process's own cwd — exactly what `exec` does for `host: "node"` calls that
 * pass no `workdir`, which is every call the social-engagement template makes.
 */
export async function runOnNode(nodes: NodesRuntime, node: string, command: string): Promise<NodeRunResult> {
  const nodeId = await resolveNodeId(nodes, node);
  const payload = unwrapInvokePayload(
    await nodes.invoke({
      nodeId,
      command: "system.run",
      params: { command: ["/bin/sh", "-lc", command] },
    }),
  );

  const exitCode = typeof payload.exitCode === "number" ? payload.exitCode : null;
  const stdout = typeof payload.stdout === "string" ? payload.stdout : "";
  if (payload.success === false || (exitCode !== null && exitCode !== 0)) {
    const stderr = typeof payload.stderr === "string" ? payload.stderr : "";
    throw new Error(`node command failed (exit ${exitCode ?? "?"}): ${stderr || stdout || "no output"}`);
  }
  return { stdout, exitCode };
}
