#!/usr/bin/env node
// `pnpm dev` helper (#718): run apps/openclaw-local-control in the background so
// creating a Project needs no manual step. Started by scripts/dev-local.sh next
// to `convex dev`; stopped with it (the script's `kill 0` trap sends SIGTERM to
// this process, which forwards it to local-control and its tsx watcher).
//
// If something already listens on the local-control port (an earlier manual
// `pnpm openclaw:local-control`), it is reused and nothing is started.
import { spawn as nodeSpawn } from "node:child_process";
import net from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function isPortOpen(port, host = "127.0.0.1") {
  return new Promise((done) => {
    const socket = net.connect({ port, host });
    socket.once("connect", () => (socket.destroy(), done(true)));
    socket.once("error", () => done(false));
    socket.setTimeout(1000, () => (socket.destroy(), done(false)));
  });
}

/** True when `port` answers GET /health like openclaw-local-control. */
export async function isLocalControlHealthy(port, host = "127.0.0.1") {
  try {
    const response = await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(2000) });
    const body = await response.json();
    return response.ok && body?.service === "@opengroow/openclaw-local-control";
  } catch {
    return false;
  }
}

/**
 * Starts local-control unless one is already listening.
 * Returns `{ reused, stop }`; `stop()` is idempotent and never kills a child
 * that already exited.
 */
export async function superviseLocalControl({
  port,
  isPortOpen: probe = isPortOpen,
  checkHealth = isLocalControlHealthy,
  spawn,
  log = console.log,
}) {
  if (await probe(port)) {
    log(`[local-control] already listening on :${port}, reusing it.`);
    if (await checkHealth(port)) {
      log(
        "[local-control] it answers /health. It must share this deployment's HMAC secret (OPENCLAW_LOCAL_CONTROL_KEYS vs OPENCLAW_CONTROL_SECRET), else creating a Project fails with 401.",
      );
    } else {
      log(
        `[local-control] WARNING: what listens on :${port} is not an openclaw-local-control (no /health answer). Creating a Project will fail: stop it or set OPENCLAW_LOCAL_CONTROL_PORT.`,
      );
    }
    return { reused: true, stop() {} };
  }
  const child = spawn();
  let exited = false;
  let stopped = false;
  child.on("error", (error) => {
    exited = true;
    log(`[local-control] failed to start: ${error?.message ?? error}. Run it by hand: pnpm openclaw:local-control`);
  });
  child.on("exit", (code, signal) => {
    exited = true;
    if (!stopped) log(`[local-control] exited unexpectedly (code ${code ?? "-"}, signal ${signal ?? "-"}).`);
  });
  log(`[local-control] started on :${port}.`);
  return {
    reused: false,
    stop() {
      if (stopped || exited) return;
      stopped = true;
      child.kill("SIGTERM");
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(import.meta.url), "../..");
  const port = Number(process.env.OPENCLAW_LOCAL_CONTROL_PORT || 4610);
  const handle = await superviseLocalControl({
    port,
    spawn: () =>
      nodeSpawn("pnpm", ["--filter", "@opengroow/openclaw-local-control", "dev"], {
        cwd: root,
        stdio: "inherit",
        env: process.env,
      }),
  });
  if (handle.reused) process.exit(0);
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.on(signal, () => {
      handle.stop();
      process.exit(0);
    });
  }
  process.on("exit", () => handle.stop());
}
