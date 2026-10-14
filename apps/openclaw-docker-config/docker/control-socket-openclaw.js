"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";
const DEFAULT_GATEWAY_CALL_TIMEOUT_MS = 10_000;
const DEFAULT_LOCAL_PREFIX = "/home/node/.local";
let callGatewayPromise;

/**
 * Single source of truth for resolving the `openclaw` binary and the env it
 * must run with. This lookup (prefer a locally-installed binary via
 * `localPrefix`, pin OPENCLAW_GATEWAY_PORT to the internal gateway port) was
 * previously copy-pasted into both control-socket-openclaw-workflow.js and
 * control-socket-whatsapp-workflow.js and could silently drift between the
 * two call sites.
 */
function resolveOpenClawBinaryAndEnv(options = {}) {
  const localPrefix = options.localPrefix ?? process.env.OPENCLAW_LOCAL_PREFIX ?? DEFAULT_LOCAL_PREFIX;
  const localOpenClawBin = path.join(localPrefix, "bin", "openclaw");
  const env = { ...process.env, OPENCLAW_GATEWAY_PORT: "18789" };
  if (fs.existsSync(localOpenClawBin)) {
    const localBinDir = path.dirname(localOpenClawBin);
    env.PATH = env.PATH ? `${localBinDir}:${env.PATH}` : localBinDir;
    return { binary: localOpenClawBin, env };
  }
  return { binary: "openclaw", env };
}

/**
 * Gateway control commands must use the shared Gateway token when one is
 * available. Otherwise OpenClaw prefers the persisted CLI device token, which
 * may only have operator.pairing and cannot approve a node that requests
 * system.run.
 *
 * Keep this limited to node/device management callers. Other OpenClaw
 * commands may legitimately use a command-specific --token option (for
 * example a channel token).
 */
function withGatewayToken(args, env = process.env) {
  const token = typeof env.OPENCLAW_GATEWAY_TOKEN === "string"
    ? env.OPENCLAW_GATEWAY_TOKEN.trim()
    : "";

  if (!token || args.includes("--token")) {
    return [...args];
  }

  return [...args, "--token", token];
}

function resolveOpenClawPackageDir() {
  const configuredPath = process.env.OPENCLAW_PACKAGE_DIR?.trim();
  if (configuredPath) {
    return configuredPath;
  }

  for (const candidate of ["/usr/local/bin/openclaw", "/usr/bin/openclaw"]) {
    try {
      return path.dirname(fs.realpathSync(candidate));
    } catch {
      // Try the next known installation path.
    }
  }

  throw new Error("Could not locate the installed OpenClaw package");
}

function resolveOpenClawDistDir() {
  return path.join(resolveOpenClawPackageDir(), "dist");
}

async function loadGatewayCaller() {
  if (!callGatewayPromise) {
    callGatewayPromise = (async () => {
      const distDir = resolveOpenClawDistDir();
      const candidates = fs
        .readdirSync(distDir)
        .filter((name) => name.startsWith("call-") && name.endsWith(".js"))
        .sort();

      for (const candidate of candidates) {
        const module = await import(
          pathToFileURL(path.join(distDir, candidate)).href,
        );
        if (typeof module.callGateway === "function") {
          return module.callGateway;
        }
        // Older OpenClaw bundles expose the same function under the minified
        // `c` export. Its function name remains stable.
        if (module.c?.name === "callGateway") {
          return module.c;
        }
      }

      throw new Error("Could not load OpenClaw gateway client");
    })();
  }

  return callGatewayPromise;
}

async function approveGatewayDevicePairing(requestId, options = {}) {
  const token = typeof process.env.OPENCLAW_GATEWAY_TOKEN === "string"
    ? process.env.OPENCLAW_GATEWAY_TOKEN.trim()
    : "";
  if (!token) {
    throw new Error("OPENCLAW_GATEWAY_TOKEN is required for device approval");
  }

  const callGateway = await loadGatewayCaller();
  return callGateway({
    url: options.url ?? process.env.OPENCLAW_GATEWAY_INTERNAL_URL ?? DEFAULT_GATEWAY_URL,
    token,
    method: "device.pair.approve",
    params: { requestId },
    timeoutMs: options.timeoutMs ?? DEFAULT_GATEWAY_CALL_TIMEOUT_MS,
    clientName: "gateway-client",
    mode: "backend",
    scopes: ["operator.admin"],
  });
}

module.exports = {
  approveGatewayDevicePairing,
  withGatewayToken,
  resolveOpenClawBinaryAndEnv,
  resolveOpenClawPackageDir,
};
