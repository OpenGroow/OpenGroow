import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  mergeMcpServers,
  removeMcpServers,
} = require("../docker/control-socket-mcp.js") as {
  mergeMcpServers: (
    input: { servers: Record<string, Record<string, unknown>> },
    options: { homeDir: string },
  ) => Promise<{ mergedKeys: string[] }>;
  removeMcpServers: (
    input: { keys: string[] },
    options: { homeDir: string },
  ) => Promise<{ removedKeys: string[] }>;
};

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function createTempHome() {
  const dir = await mkdtemp(path.join(tmpdir(), "openclaw-mcp-"));
  tempDirs.push(dir);
  await mkdir(path.join(dir, ".openclaw"), { recursive: true });
  return dir;
}

async function readOpenClawConfig(homeDir: string) {
  return JSON.parse(
    await readFile(path.join(homeDir, ".openclaw", "openclaw.json"), "utf8"),
  ) as Record<string, unknown>;
}

describe("control-socket MCP helpers", () => {
  it("merges MCP server configs into openclaw.json", async () => {
    const homeDir = await createTempHome();

    const result = await mergeMcpServers(
      {
        servers: {
          "seo-site-analysis": { transport: "sse", url: "https://mcp.test/seo" },
          "seo-keyword-research": { command: "node", args: ["server.js"] },
        },
      },
      { homeDir },
    );

    expect(result.mergedKeys).toEqual(["seo-site-analysis", "seo-keyword-research"]);
    const config = await readOpenClawConfig(homeDir);
    expect(config.mcp).toEqual({
      servers: {
        "seo-site-analysis": { transport: "sse", url:"https://mcp.test/seo" },
        "seo-keyword-research": { command: "node", args: ["server.js"] },
      },
    });
  });

  it("removes only requested MCP server keys", async () => {
    const homeDir = await createTempHome();
    await mergeMcpServers(
      {
        servers: {
          keep: { transport: "sse", url:"https://mcp.test/keep" },
          remove: { transport: "sse", url:"https://mcp.test/remove" },
        },
      },
      { homeDir },
    );

    const result = await removeMcpServers({ keys: ["remove", "missing"] }, { homeDir });

    expect(result.removedKeys).toEqual(["remove"]);
    const config = await readOpenClawConfig(homeDir);
    expect(config.mcp).toEqual({
      servers: {
        keep: { transport: "sse", url:"https://mcp.test/keep" },
      },
    });
  });

  it("rejects empty merge payloads", async () => {
    const homeDir = await createTempHome();

    await expect(mergeMcpServers({ servers: {} }, { homeDir })).rejects.toThrow(
      /servers is required/,
    );
  });
});
