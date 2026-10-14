/**
 * Recognizes a node-host exec call from a hook event, whatever the harness.
 * Agent-specific matchers (which command, which ids) are built on top of it by
 * the plugin that owns the agent.
 */

/** Minimal shape this module needs from `PluginHookAfterToolCallEvent`. */
export type ToolCallLikeEvent = {
  toolName: string;
  params: Record<string, unknown>;
  /** Set when the tool call itself failed. */
  error?: unknown;
};

/**
 * `exec` (the default harness tool) reaches the paired Mac only when called
 * with `host: "node"` — a plain `exec` call with no host runs in-container
 * and is irrelevant here. The Codex harness instead exposes a dedicated
 * `node_exec` tool that is *always* the node bridge (no `host` param at all;
 * confirmed against a live session transcript for the Codex/gpt-5.5 run that
 * originally reported this bug — its `node_exec` calls carried only
 * `command`, `workdir`, `timeoutSeconds`).
 */
export function isNodeHostExecCall(event: ToolCallLikeEvent): boolean {
  if (event.toolName === "node_exec") {
    return true;
  }
  return event.toolName === "exec" && event.params.host === "node";
}
