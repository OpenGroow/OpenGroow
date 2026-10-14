#!/usr/bin/env node

const http = require("node:http");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const { spawn } = require("node:child_process");
const { dirname, join } = require("node:path");
const { createNodeWorkflow } = require("./control-socket-node-workflow");
const { createWhatsAppWorkflow } = require("./control-socket-whatsapp-workflow");
const { createChannelWorkflow } = require("./control-socket-channel-workflow");
const { createAuthWorkflow } = require("./control-socket-auth-workflow");
const {
  createMcpWorkflow,
} = require("./control-socket-mcp-workflow");
const { createWorkspaceWorkflow } = require("./control-socket-workspace-workflow");
const { createOpenClawWorkflow } = require("./control-socket-openclaw-workflow");
const { createPluginsWorkflow } = require("./control-socket-plugins-workflow");
const { toErrorMessage } = require("./control-socket-errors");
const {
  readSessionTranscript,
} = require("./control-socket-sessions");
const {
  driveChildToCompletion,
} = require("./control-socket-run-command");
const {
  approveGatewayDevicePairing,
  withGatewayToken,
} = require("./control-socket-openclaw");

const SOCKET_PATH =
  process.env.OPENCLAW_CONTROL_SOCKET_PATH ??
  "/home/node/.openclaw/runtime/control.sock";
const PENDING_DEVICES_PATH =
  process.env.OPENCLAW_PENDING_DEVICES_PATH?.trim() ??
  "/home/node/.openclaw/devices/pending.json";
const AUTH_SESSIONS_PATH =
  process.env.OPENCLAW_AUTH_SESSIONS_PATH ??
  join(dirname(SOCKET_PATH), "auth-sessions.json");
const STATUS_TIMEOUT_MS = Number(
  process.env.OPENCLAW_GATEWAY_STATUS_TIMEOUT_MS ?? "30000",
);
const CONFIG_TIMEOUT_MS = Number(
  process.env.OPENCLAW_GATEWAY_CONFIG_TIMEOUT_MS ?? "60000",
);
const EXEC_TIMEOUT_MS = Number(
  process.env.OPENCLAW_GATEWAY_EXEC_TIMEOUT_MS ?? "30000",
);
const CHANNEL_LOGIN_TIMEOUT_MS = Number(
  process.env.OPENCLAW_GATEWAY_CHANNEL_LOGIN_TIMEOUT_MS ?? "180000",
);
const AUTH_SESSION_TTL_MS = Number(
  process.env.OPENCLAW_AUTH_SESSION_TTL_MS ?? "3600000",
);
const AUTH_LOG_MAX_LINES = Number(
  process.env.OPENCLAW_AUTH_LOG_MAX_LINES ?? "300",
);
const AUTH_PROMPT_TIMEOUT_MS = Number(
  process.env.OPENCLAW_AUTH_PROMPT_TIMEOUT_MS ?? "90000",
);
const AUTH_VERIFY_TIMEOUT_MS = Number(
  process.env.OPENCLAW_AUTH_VERIFY_TIMEOUT_MS ?? "180000",
);
const WHATSAPP_PAIR_SESSION_TTL_MS = Number(
  process.env.OPENCLAW_WHATSAPP_PAIR_SESSION_TTL_MS ?? "170000",
);

function log(message) {
  console.log(`[control-socket] ${message}`);
}

function warn(message) {
  console.warn(`[control-socket] ${message}`);
}

function scheduleGatewayContainerRestart() {
  setTimeout(() => {
    try {
      log("restarting gateway container via PID 1");
      process.kill(1, "SIGTERM");
    } catch (error) {
      warn(`failed to restart gateway container: ${toErrorMessage(error)}`);
    }
  }, 100);
}

function respondJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

async function runCommandCapture(command, args, timeoutMs) {
  const result = await runCommandDetailed(command, args, timeoutMs);
  if (result.exitCode === 0) {
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
  throw new Error(
    result.stderr ||
      result.stdout ||
      `${command} exited with code ${result.exitCode ?? "unknown"}${result.signal ? ` (${result.signal})` : ""}`,
  );
}

async function runCommandDetailed(command, args, timeoutMs) {
  return await runCommandDetailedWithOptions(command, args, timeoutMs, {});
}

async function runCommandDetailedWithOptions(
  command,
  args,
  timeoutMs,
  options,
) {
  const child = spawn(command, args, {
    env: options?.env ?? envForCommand(command),
    stdio: ["ignore", "pipe", "pipe"],
  });
  return await driveChildToCompletion(child, timeoutMs, {
    timeoutLabel: `${command} ${args[0] ?? ""}`,
  });
}

const authWorkflow = createAuthWorkflow({
  authSessionsPath: AUTH_SESSIONS_PATH,
  authSessionTtlMs: AUTH_SESSION_TTL_MS,
  authLogMaxLines: AUTH_LOG_MAX_LINES,
  authPromptTimeoutMs: AUTH_PROMPT_TIMEOUT_MS,
  authVerifyTimeoutMs: AUTH_VERIFY_TIMEOUT_MS,
  configTimeoutMs: CONFIG_TIMEOUT_MS,
  fs: fsPromises,
  log,
  runCommandCapture,
  spawnProcess: spawn,
  warn,
});

function runGatewayNodeCommand(args, timeoutMs) {
  return runCommandCapture(
    "openclaw",
    withGatewayToken(args),
    timeoutMs,
  );
}

// This control socket always runs colocated, in the same container, with
// the OpenClaw gateway it manages — which always listens internally on
// 18789 (docker-compose.yml's `command: openclaw gateway ... --port 18789`
// is fixed, never templated). `OPENCLAW_GATEWAY_PORT` in this container's
// own env is NOT that internal port, though: it's set (docker-compose.yml)
// to the per-instance HOST-published port (e.g. 19100), so that
// discoverExistingInstances (openclaw-local-control/discover-instances.ts)
// can recover it via `docker inspect` after a restart. An `openclaw` CLI
// invocation spawned here that just inherits process.env would pick up
// that host port as its gateway target and fail to connect to itself
// (nothing listens on the host port from inside the container's own
// network namespace) — so every `openclaw` subprocess this file spawns
// must have it pinned back to the real internal port.
function isOpenClawCommand(command) {
  return command === "openclaw" || command.endsWith("/openclaw");
}

function envForCommand(command) {
  if (!isOpenClawCommand(command)) {
    return process.env;
  }
  return { ...process.env, OPENCLAW_GATEWAY_PORT: "18789" };
}

async function handleSessionTranscriptRead(req, res) {
  const body = await readJsonBody(req);
  const agentName = typeof body.agentName === "string" ? body.agentName.trim() : "";
  const sessionKey = typeof body.sessionKey === "string" ? body.sessionKey.trim() : "";

  try {
    const result = await readSessionTranscript({ agentName, sessionKey });
    respondJson(res, 200, {
      ok: true,
      data: result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read session transcript";
    respondJson(res, 400, {
      ok: false,
      error: message,
    });
  }
}

async function readOpenClawConfigValue(path) {
  try {
    const result = await runCommandCapture(
      "openclaw",
      ["config", "get", path, "--json"],
      CONFIG_TIMEOUT_MS,
    );
    if (!result.stdout) {
      return null;
    }
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

const nodeWorkflow = createNodeWorkflow({
  approveGatewayDevicePairing,
  configTimeoutMs: CONFIG_TIMEOUT_MS,
  fs: fsPromises,
  pendingDevicesPath: PENDING_DEVICES_PATH,
  runGatewayNodeCommand,
});

const whatsappWorkflow = createWhatsAppWorkflow({
  fs: fsPromises,
  log,
  pairSessionTtlMs: WHATSAPP_PAIR_SESSION_TTL_MS,
  runCommandCapture,
  scheduleGatewayContainerRestart,
  spawnProcess: spawn,
  statusTimeoutMs: STATUS_TIMEOUT_MS,
  warn,
});

const channelWorkflow = createChannelWorkflow({
  configTimeoutMs: CONFIG_TIMEOUT_MS,
  log,
  readOpenClawConfigValue,
  runCommandCapture,
  scheduleGatewayContainerRestart,
});

const workspaceWorkflow = createWorkspaceWorkflow();
const mcpWorkflow = createMcpWorkflow();
const pluginsWorkflow = createPluginsWorkflow({ log });
const openClawWorkflow = createOpenClawWorkflow({
  channelLoginTimeoutMs: CHANNEL_LOGIN_TIMEOUT_MS,
  execTimeoutMs: EXEC_TIMEOUT_MS,
  log,
  scheduleGatewayContainerRestart,
});

async function handleWorkflowRoute(req, res, operation) {
  const body = await readJsonBody(req);
  const result = await operation(body);
  if (typeof result.afterResponse === "function") {
    res.on("finish", result.afterResponse);
  }
  respondJson(res, result.status, result.body);
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url ?? "/", "http://unix");
    if (req.method === "GET" && url.pathname === "/health") {
      respondJson(res, 200, { ok: true, service: "openclaw-control-socket" });
      return;
    }

    if (req.method === "POST" && url.pathname === "/whatsapp/config") {
      await handleWorkflowRoute(req, res, channelWorkflow.configureWhatsApp);
      return;
    }

    if (req.method === "POST" && url.pathname === "/nodes/approve") {
      await handleWorkflowRoute(req, res, nodeWorkflow.approve);
      return;
    }

    if (req.method === "POST" && url.pathname === "/nodes/pending-list") {
      await handleWorkflowRoute(req, res, nodeWorkflow.pendingList);
      return;
    }

    if (req.method === "POST" && url.pathname === "/nodes/check") {
      await handleWorkflowRoute(req, res, nodeWorkflow.check);
      return;
    }

    if (req.method === "POST" && url.pathname === "/nodes/cleanup-stale") {
      await handleWorkflowRoute(req, res, nodeWorkflow.cleanupStale);
      return;
    }

    if (req.method === "POST" && url.pathname === "/telegram/config") {
      await handleWorkflowRoute(req, res, channelWorkflow.configureTelegram);
      return;
    }

    if (req.method === "POST" && url.pathname === "/ai/config") {
      await handleWorkflowRoute(req, res, channelWorkflow.configureAi);
      return;
    }

    if (req.method === "POST" && url.pathname === "/speech-to-text/config") {
      await handleWorkflowRoute(req, res, channelWorkflow.configureSpeechToText);
      return;
    }

    if (req.method === "POST" && url.pathname === "/workspace/list") {
      await handleWorkflowRoute(req, res, workspaceWorkflow.list);
      return;
    }

    if (req.method === "POST" && url.pathname === "/workspace/file") {
      await handleWorkflowRoute(req, res, workspaceWorkflow.read);
      return;
    }

    if (req.method === "POST" && url.pathname === "/workspace/skill/files") {
      await handleWorkflowRoute(req, res, workspaceWorkflow.skillFiles);
      return;
    }

    if (req.method === "POST" && url.pathname === "/workspace/create") {
      await handleWorkflowRoute(req, res, workspaceWorkflow.create);
      return;
    }

    if (req.method === "POST" && url.pathname === "/workspace/file/write") {
      await handleWorkflowRoute(req, res, workspaceWorkflow.write);
      return;
    }

    if (req.method === "POST" && url.pathname === "/workspace/file/delete") {
      await handleWorkflowRoute(req, res, workspaceWorkflow.remove);
      return;
    }

    if (req.method === "POST" && url.pathname === "/session/transcript") {
      await handleSessionTranscriptRead(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/mcp/servers/merge") {
      await handleWorkflowRoute(req, res, mcpWorkflow.merge);
      return;
    }

    if (req.method === "POST" && url.pathname === "/mcp/servers/remove") {
      await handleWorkflowRoute(req, res, mcpWorkflow.remove);
      return;
    }

    if (req.method === "POST" && url.pathname === "/plugins/install") {
      await handleWorkflowRoute(req, res, pluginsWorkflow.install);
      return;
    }

    if (req.method === "POST" && url.pathname === "/auth/start") {
      await handleWorkflowRoute(req, res, authWorkflow.start);
      return;
    }

    if (req.method === "POST" && url.pathname === "/auth/status") {
      await handleWorkflowRoute(req, res, authWorkflow.status);
      return;
    }

    if (req.method === "POST" && url.pathname === "/auth/input") {
      await handleWorkflowRoute(req, res, authWorkflow.input);
      return;
    }

    if (req.method === "POST" && url.pathname === "/auth/cancel") {
      await handleWorkflowRoute(req, res, authWorkflow.cancel);
      return;
    }

    if (req.method === "POST" && url.pathname === "/auth/activate") {
      await handleWorkflowRoute(req, res, authWorkflow.activate);
      return;
    }

    if (req.method === "POST" && url.pathname === "/auth/order-activate") {
      await handleWorkflowRoute(req, res, authWorkflow.orderActivate);
      return;
    }

    if (req.method === "POST" && url.pathname === "/whatsapp/pair/start") {
      await handleWorkflowRoute(req, res, whatsappWorkflow.pairStart);
      return;
    }

    if (req.method === "POST" && url.pathname === "/whatsapp/pair/wait") {
      await handleWorkflowRoute(req, res, whatsappWorkflow.pairWait);
      return;
    }

    if (req.method === "POST" && url.pathname === "/whatsapp/logout") {
      await whatsappWorkflow.logout();
      respondJson(res, 200, {
        ok: true,
        data: { output: "WhatsApp logout requested." },
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/openclaw/exec") {
      await handleWorkflowRoute(req, res, openClawWorkflow.execute);
      return;
    }

    if (req.method === "POST" && url.pathname === "/openclaw/exec/cancel") {
      await handleWorkflowRoute(req, res, openClawWorkflow.cancel);
      return;
    }

    respondJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    respondJson(res, 500, {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "OpenClaw control socket error",
    });
  }
}

async function start() {
  fs.mkdirSync(dirname(SOCKET_PATH), { recursive: true });
  await authWorkflow.load();
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      if (error.code === "ENOTSUP") {
        // VirtioFS (Docker Desktop on macOS) can't unlink socket files via
        // Node.js — fall back to a shell rm which goes through a different path.
        try {
          require("node:child_process").execFileSync("rm", ["-f", SOCKET_PATH]);
        } catch (_rmError) {
          // If rm also fails we'll get EADDRINUSE from server.listen — let that
          // surface rather than crashing here with a confusing error.
        }
      } else {
        throw error;
      }
    }
  }

  const server = http.createServer((req, res) => {
    void handleRequest(req, res);
  });

  server.listen(SOCKET_PATH, () => {
    log(`listening on ${SOCKET_PATH}`);
  });

  const shutdown = () => {
    void Promise.all([authWorkflow.close(), whatsappWorkflow.close()]).finally(() => {
      server.close(() => {
        try { fs.unlinkSync(SOCKET_PATH); } catch (_e) { /* ignore */ }
        process.exit(0);
      });
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Importable seam (issue #365): requiring this module must never start a
// socket or touch the filesystem by itself — only production's own
// entrypoint invocation below does that. Tests can `require()` this file
// and call `handleRequest(req, res)` directly against a fake req/res pair
// to exercise the real routing/dispatch without any process side effect.
module.exports = { handleRequest, start };

// Production entrypoint: only auto-start when this file is the process's
// main module (`node control-socket-server.js`), not when it's required by
// a test.
if (require.main === module) {
  void start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
