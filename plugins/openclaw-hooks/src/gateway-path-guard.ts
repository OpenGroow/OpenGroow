import { isNodeHostExecCall } from "./command-match.js";

/**
 * The gateway workspace (`/home/node/.openclaw/...`) only exists inside the
 * gateway container. A node-host exec (`node_exec`, or `exec` with
 * `host: "node"`) runs on the paired Mac, where that path does not exist: the
 * call is denied with `SYSTEM_RUN_DENIED: approval requires an existing
 * canonical cwd`, and the agent then wastes its time searching the Mac for
 * files that are not there. Reject it up front with a message that points at
 * the native `read` / `write` tools instead.
 */
const GATEWAY_WORKSPACE_PREFIX = "/home/node/.openclaw/";

export const GATEWAY_PATH_BLOCK_REASON =
  "This command runs on the paired Mac node, where the gateway workspace path does not exist. " +
  "Read and write mission files (context.md, runs/<runId>.md, outputs/<runId>.json, SKILL.md) with the native `read` / `write` tools, " +
  "not with node exec. Use node exec only for `opengroow-android`, without a workspace `workdir`.";

type BeforeToolCallLikeEvent = { toolName: string; params: Record<string, unknown> };
type BeforeToolCallContextLike = { agentId?: string };

/**
 * Agent-specific restriction on node-host commands, supplied by the plugin that
 * owns the agent. Returns the reason to block with, or `undefined` to allow.
 */
export type NodeCommandPolicy = (context: BeforeToolCallContextLike, command: unknown) => string | undefined;

export function handleBeforeToolCall(
  event: BeforeToolCallLikeEvent,
  context: BeforeToolCallContextLike = {},
  restrictNodeCommand?: NodeCommandPolicy,
): { block: true; blockReason: string } | undefined {
  if (!isNodeHostExecCall(event)) {
    return undefined;
  }

  const restriction = restrictNodeCommand?.(context, event.params.command);
  if (restriction !== undefined) {
    return { block: true, blockReason: restriction };
  }

  const workdir = event.params.workdir;
  if (typeof workdir !== "string" || !workdir.startsWith(GATEWAY_WORKSPACE_PREFIX)) {
    return undefined;
  }
  return { block: true, blockReason: GATEWAY_PATH_BLOCK_REASON };
}
