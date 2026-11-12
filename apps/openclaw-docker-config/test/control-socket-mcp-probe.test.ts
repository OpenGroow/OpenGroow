import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

type ProbeRun = { stdout: string; stderr: string; exitCode: number | null };
type ProbeResult = { key: string; ok: boolean; error?: string };

const { probeMcpServers } = require("../docker/control-socket-mcp-probe.js") as {
  probeMcpServers: (
    input: { keys: unknown; timeoutMs?: number },
    options: { runProbe: (key: string, timeoutMs: number) => Promise<ProbeRun> },
  ) => Promise<{ results: ProbeResult[] }>;
};
const { createMcpWorkflow } = require("../docker/control-socket-mcp-workflow.js") as {
  createMcpWorkflow: (options: { runProbe: (key: string, timeoutMs: number) => Promise<ProbeRun> }) => {
    probe: (body: unknown) => Promise<{ status: number; body: { ok: boolean; data?: { results: ProbeResult[] }; error?: string } }>;
  };
};

// Shapes printed by `openclaw mcp probe <key> --json` (OpenClaw 2026.9.1).
const reachable = (key: string): ProbeRun => ({
  stdout: JSON.stringify({ servers: { [key]: {} }, tools: [{ name: "analyze_reel" }], diagnostics: [] }),
  stderr: "",
  exitCode: 0,
});
const blocked = (key: string): ProbeRun => ({
  stdout: JSON.stringify({
    servers: {},
    tools: [],
    diagnostics: [{ serverName: key, message: "Blocked: resolves to private/internal/special-use IP address" }],
  }),
  stderr: "\u001b[34m[bundle-mcp]\u001b[39m failed to start server",
  exitCode: 1,
});
const unknown = (key: string): ProbeRun => ({
  stdout: JSON.stringify({ ok: false, error: { type: "cli_error", message: `No MCP server named "${key}"` } }),
  stderr: "",
  exitCode: 1,
});

describe("probeMcpServers", () => {
  it("reports each server's verdict with OpenClaw's own reason", async () => {
    const runs: Record<string, ProbeRun> = {
      "enrich-mcp": blocked("enrich-mcp"),
      "seo-mcp": reachable("seo-mcp"),
      "gone-mcp": unknown("gone-mcp"),
    };
    const { results } = await probeMcpServers(
      { keys: ["enrich-mcp", "seo-mcp", "gone-mcp"] },
      { runProbe: async (key) => runs[key] },
    );
    expect(results).toEqual([
      { key: "enrich-mcp", ok: false, error: "Blocked: resolves to private/internal/special-use IP address" },
      { key: "seo-mcp", ok: true },
      { key: "gone-mcp", ok: false, error: 'No MCP server named "gone-mcp"' },
    ]);
  });

  it("falls back to the last stderr line when stdout is not a report", async () => {
    const { results } = await probeMcpServers(
      { keys: ["enrich-mcp"] },
      { runProbe: async () => ({ stdout: "", stderr: "boot\n\u001b[33mconfig is invalid\u001b[39m\n", exitCode: 1 }) },
    );
    expect(results).toEqual([{ key: "enrich-mcp", ok: false, error: "config is invalid" }]);
  });

  it("turns a probe that times out into a failed verdict", async () => {
    const { results } = await probeMcpServers(
      { keys: ["enrich-mcp"], timeoutMs: 1234 },
      {
        runProbe: async (key, timeoutMs) => {
          throw new Error(`openclaw mcp probe ${key} timed out after ${timeoutMs}ms`);
        },
      },
    );
    expect(results).toEqual([
      { key: "enrich-mcp", ok: false, error: "openclaw mcp probe enrich-mcp timed out after 1234ms" },
    ]);
  });

  it("probes a repeated key once and rejects keys that are not server names", async () => {
    const runProbe = vi.fn(async (key: string) => reachable(key));
    await probeMcpServers({ keys: ["seo-mcp", " seo-mcp "] }, { runProbe });
    expect(runProbe).toHaveBeenCalledTimes(1);
    await expect(probeMcpServers({ keys: ["--all; rm"] }, { runProbe })).rejects.toThrow("Invalid MCP server key");
    await expect(probeMcpServers({ keys: [] }, { runProbe })).rejects.toThrow("keys is required");
  });
});

describe("MCP workflow probe route", () => {
  it("answers 200 with per-server results, 400 for a malformed request", async () => {
    const workflow = createMcpWorkflow({ runProbe: async (key) => blocked(key) });
    const ok = await workflow.probe({ keys: ["enrich-mcp"] });
    expect(ok.status).toBe(200);
    expect(ok.body.data?.results[0]).toMatchObject({ key: "enrich-mcp", ok: false });
    const bad = await workflow.probe({});
    expect(bad.status).toBe(400);
  });
});
