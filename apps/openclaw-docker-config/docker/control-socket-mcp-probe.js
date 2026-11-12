"use strict";

const { spawn } = require("node:child_process");
const { driveChildToCompletion } = require("./control-socket-run-command");
const { resolveOpenClawBinaryAndEnv } = require("./control-socket-openclaw");

// OpenClaw gives a server 30s to answer `initialize`; leave room for the CLI
// to boot around it.
const DEFAULT_MCP_PROBE_TIMEOUT_MS = 45_000;
const MCP_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const ANSI_RE = /\u001b\[[0-9;]*m/g;

function lastLine(text) {
  const lines = String(text ?? "").replace(ANSI_RE, "").trim().split("\n");
  return lines[lines.length - 1].trim();
}

/**
 * Reads one `openclaw mcp probe <key> --json` run into a verdict. The CLI
 * prints a JSON report on stdout: a server it could not start is listed in
 * `diagnostics` with the reason, and an unknown name is a `{ ok: false,
 * error }` object. Only a clean exit with no diagnostic counts as reachable.
 */
function parseMcpProbeOutput(key, { stdout, stderr, exitCode }) {
  let report = null;
  try {
    report = JSON.parse(String(stdout ?? "").trim());
  } catch {
    report = null;
  }
  const diagnostics = Array.isArray(report?.diagnostics) ? report.diagnostics : [];
  const diagnostic = diagnostics.find((entry) => entry?.serverName === key) ?? diagnostics[0];
  if (diagnostic) return { key, ok: false, error: String(diagnostic.message ?? "MCP server failed to start") };
  if (report?.ok === false) return { key, ok: false, error: String(report.error?.message ?? "MCP probe failed") };
  if (report && exitCode === 0) return { key, ok: true };
  return { key, ok: false, error: lastLine(stderr) || lastLine(stdout) || `MCP probe exited with code ${exitCode}` };
}

function defaultRunProbe(key, timeoutMs) {
  const { binary, env } = resolveOpenClawBinaryAndEnv();
  const child = spawn(binary, ["mcp", "probe", key, "--json"], { env, stdio: ["ignore", "pipe", "pipe"] });
  return driveChildToCompletion(child, timeoutMs, { timeoutLabel: `openclaw mcp probe ${key}` });
}

/**
 * Connects to each named MCP server the way an Agent session would, and
 * reports which ones OpenClaw cannot start (unreachable, blocked by its SSRF
 * guard, rejected auth, not configured). Lets a caller refuse to start a
 * session whose tools would silently be missing.
 */
async function probeMcpServers({ keys, timeoutMs }, options = {}) {
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error("keys is required and must be a non-empty array");
  }
  const normalized = Array.from(new Set(keys.map((key) => (typeof key === "string" ? key.trim() : ""))));
  for (const key of normalized) {
    if (!MCP_KEY_RE.test(key)) throw new Error(`Invalid MCP server key: ${key}`);
  }
  const runProbe = options.runProbe ?? defaultRunProbe;
  const budget = typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : DEFAULT_MCP_PROBE_TIMEOUT_MS;
  const results = await Promise.all(
    normalized.map(async (key) => {
      try {
        return parseMcpProbeOutput(key, await runProbe(key, budget));
      } catch (error) {
        return { key, ok: false, error: error instanceof Error ? error.message : "MCP probe failed" };
      }
    }),
  );
  return { results };
}

module.exports = { probeMcpServers, parseMcpProbeOutput };
