import { writeFile, readFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { runOnNode, shellQuote, type NodesRuntime } from "./node-run.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : error === undefined ? "" : String(error);
}

/**
 * External effects a hook performs against the paired node host and the agent
 * workspace, injected so a hook's logic can be tested without a real OpenClaw
 * plugin runtime, node host, or filesystem.
 */
export type PluginRuntimeDeps = {
  /** `cat`s a file on the paired node host and returns its content. */
  readNodeFile: (params: { node: string; path: string }) => Promise<string>;
  /** Writes content into the agent workspace, creating parent dirs as needed. */
  writeWorkspaceFile: (params: { agentId: string; relativePath: string; content: string }) => Promise<void>;
  /** Reads back a file from the agent workspace. */
  readWorkspaceFile: (params: { agentId: string; relativePath: string }) => Promise<string>;
  /** Recursively deletes a directory on the paired node host. */
  deleteNodeDir: (params: { node: string; path: string }) => Promise<void>;
  /** Reports a failure without ever propagating it back to the triggering tool call. */
  logError: (message: string, error: unknown) => void;
};

/**
 * Builds the real `PluginRuntimeDeps` from a trusted native plugin's
 * `OpenClawPluginApi`.
 */
export function createPluginRuntimeDeps(api: OpenClawPluginApi): PluginRuntimeDeps {
  const nodes: NodesRuntime = api.runtime.nodes;

  return {
    async readNodeFile({ node, path }) {
      const { stdout } = await runOnNode(nodes, node, `cat ${shellQuote(path)}`);
      // An empty read must fail loudly: returning "" would overwrite a good
      // workspace copy with an empty file and still count as a successful sync.
      if (!stdout) {
        throw new Error(`node host returned no content for ${path}`);
      }
      return stdout;
    },

    async writeWorkspaceFile({ agentId, relativePath, content }) {
      const workspaceDir = api.runtime.agent.resolveAgentWorkspaceDir(api.config, agentId);
      const absolutePath = join(workspaceDir, relativePath);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, "utf8");
    },

    async readWorkspaceFile({ agentId, relativePath }) {
      const workspaceDir = api.runtime.agent.resolveAgentWorkspaceDir(api.config, agentId);
      return readFile(join(workspaceDir, relativePath), "utf8");
    },

    async deleteNodeDir({ node, path }) {
      await runOnNode(nodes, node, `rm -rf ${shellQuote(path)}`);
    },

    logError(message, error) {
      const detail = errorMessage(error);
      api.logger.error(detail ? `${message}: ${detail}` : message);
    },
  };
}
