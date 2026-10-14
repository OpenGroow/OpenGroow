/**
 * The real machine behind `MachineToolPorts` (#726): the Node process running
 * on the user's own computer (the paired node). Node-only.
 */
import { spawn } from "node:child_process";
import { mkdir, rename, rm, writeFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MachineToolPorts } from "./machine-tool-install";

export const DEFAULT_TOOLS_ROOT = join(homedir(), ".opengroow", "tools");

export function nodeMachineToolPorts(toolsRoot: string = DEFAULT_TOOLS_ROOT): MachineToolPorts {
  return {
    toolsRoot,
    async download(url) {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
    fs: {
      exists: (path) => access(path).then(() => true, () => false),
      mkdir: async (path) => void (await mkdir(path, { recursive: true })),
      write: (path, bytes) => writeFile(path, bytes),
      rename,
      remove: (path) => rm(path, { recursive: true, force: true }),
    },
    run(argv) {
      return new Promise((resolve) => {
        const [command, ...args] = argv;
        const child = spawn(command!, args, { stdio: ["ignore", "pipe", "pipe"] });
        let output = "";
        child.stdout.on("data", (chunk: Buffer) => (output += chunk));
        child.stderr.on("data", (chunk: Buffer) => (output += chunk));
        child.on("error", (error) => resolve({ code: 127, output: error.message }));
        child.on("close", (code) => resolve({ code: code ?? 1, output }));
      });
    },
  };
}
