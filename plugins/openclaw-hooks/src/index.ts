// General hooks toolkit for OpenClaw plugins that run in-process in the Gateway.
// An agent's own plugin (shipped inside its package) imports from here and adds
// its agent-specific hooks; see AGENTS.md.
export { isNodeHostExecCall, type ToolCallLikeEvent } from "./command-match.js";
export {
  GATEWAY_PATH_BLOCK_REASON,
  handleBeforeToolCall,
  type NodeCommandPolicy,
} from "./gateway-path-guard.js";
export { runOnNode, shellQuote, type NodesRuntime } from "./node-run.js";
export { createPluginRuntimeDeps, type PluginRuntimeDeps } from "./plugin-runtime-deps.js";
