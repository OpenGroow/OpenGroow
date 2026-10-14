import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStateRoot } from "./state-root.js";
import { sleep } from "./ws-utils.js";

const EXTENSION_RELAY_PORT = 18792;
const LOCAL_OPENCLAW_BIN = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../node_modules/.bin/openclaw",
);
const LOCAL_OPENCLAW_PROCESS_NAMES = new Set([
  "openclaw-extension",
  "openclaw-gateway",
  "openclaw-node",
]);

export function resolveOpenClawStateDir(stateKey?: string): string {
  const explicitStateDir = process.env.OPENCLAW_STATE_DIR?.trim();
  if (explicitStateDir) {
    return explicitStateDir;
  }

  const stateRoot = resolveStateRoot();
  const normalizedStateKey = normalizeStateKey(stateKey);
  return normalizedStateKey ? path.join(stateRoot, normalizedStateKey) : stateRoot;
}

function normalizeStateKey(stateKey: string | undefined): string {
  const normalized = stateKey?.trim().replace(/[^a-zA-Z0-9._-]+/g, "_") ?? "";
  if (!normalized || normalized === "." || normalized === "..") {
    return "";
  }
  return normalized;
}

export function resolveOpenClawBin(explicitBin?: string): string {
  const normalizedExplicitBin = explicitBin?.trim();
  if (normalizedExplicitBin) {
    return normalizedExplicitBin;
  }

  return existsSync(LOCAL_OPENCLAW_BIN) ? LOCAL_OPENCLAW_BIN : "openclaw";
}

export async function ensureLocalNodeConfig(stateDir: string): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  const configPath = path.join(stateDir, "openclaw.json");

  // Read and merge with any existing config so that exec-policy metadata
  // written by `openclaw exec-policy set` is not erased on restart.
  let existing: Record<string, unknown> = {};
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    // No existing config or parse error — start fresh.
  }

  // Remove legacy tools.exec.mode if present — it conflicts with the security/ask
  // fields written by `openclaw exec-policy set` and prevents the exec socket from starting.
  // We preserve the rest of the existing config (including exec-policy metadata).
  const tools = existing.tools;
  if (tools && typeof tools === "object" && !Array.isArray(tools)) {
    const exec = (tools as Record<string, unknown>).exec;
    if (exec && typeof exec === "object" && !Array.isArray(exec) && "mode" in (exec as Record<string, unknown>)) {
      const { mode: _mode, ...execWithoutMode } = exec as Record<string, unknown>;
      existing = {
        ...existing,
        tools: {
          ...(tools as Record<string, unknown>),
          exec: execWithoutMode,
        },
      };
    }
  }

  const existingTools = (existing.tools as Record<string, unknown> | undefined) ?? {};
  const existingExec = (existingTools.exec as Record<string, unknown> | undefined) ?? {};
  // lastTouchedAt was retired from the canonical config schema (2026.9.1+); strip it
  // from any config written by an older version instead of carrying it forward forever.
  const { lastTouchedAt: _lastTouchedAt, ...existingMeta } =
    (existing.meta as Record<string, unknown> | undefined) ?? {};

  const merged = {
    ...existing,
    tools: {
      ...existingTools,
      exec: {
        security: "full",
        ask: "off",
        ...existingExec,
      },
    },
    browser: {
      defaultProfile: "chrome",
      profiles: {
        chrome: {
          driver: "openclaw",
          cdpUrl: `http://127.0.0.1:${EXTENSION_RELAY_PORT}`,
        },
      },
    },
    nodeHost: {
      browserProxy: {
        enabled: true,
      },
    },
    // openclaw reads this to confirm exec-policy was intentionally set.
    // Without lastTouchedVersion the node skips announcing the system.run cap.
    meta: {
      lastTouchedVersion: "2026.9.1",
      ...existingMeta,
    },
  };

  await writeFile(configPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  console.error(
    `[node-run-helper] wrote local OpenClaw config at ${configPath}`,
  );
}

export async function rotateInvalidLocalNodeIdentity(stateDir: string): Promise<void> {
  const suffix = `invalid-${Date.now()}`;
  for (const entry of ["identity", "node.json"]) {
    const source = path.join(stateDir, entry);
    const destination = path.join(stateDir, `${entry}.${suffix}`);
    try {
      await rename(source, destination);
      console.error(
        `[node-run-helper] preserved stale ${entry} as ${path.basename(destination)}`,
      );
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (code !== "ENOENT") {
        throw error;
      }
    }
  }
}

export async function pruneStaleIdentities(stateDir: string, keepCount = 1): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(stateDir);
  } catch {
    return;
  }
  for (const prefix of ["identity.invalid-", "node.json.invalid-"]) {
    const candidates = entries.filter((e) => e.startsWith(prefix)).sort();
    const toDelete = candidates.slice(0, Math.max(0, candidates.length - keepCount));
    for (const name of toDelete) {
      await rm(path.join(stateDir, name), { recursive: true, force: true });
      console.error(`[node-run-helper] pruned stale file ${name}`);
    }
  }
}

export async function cleanupLocalOpenClawRelayProcesses(
  context: "startup" | "shutdown",
): Promise<void> {
  const relayOwners = listListeningProcessIds(EXTENSION_RELAY_PORT)
    .map((pid) => ({ pid, command: getProcessCommand(pid) }))
    .filter(({ command }) => isLocalOpenClawProcess(command));

  const orphanedProcesses = listOrphanedLocalOpenClawProcesses();
  const staleProcessIds = uniqueProcessIds([
    ...relayOwners.map(({ pid }) => pid),
    ...orphanedProcesses.map(({ pid }) => pid),
  ]);

  if (staleProcessIds.length === 0) {
    return;
  }

  console.error(
    `[node-run-helper] ${context}: stopping stale local OpenClaw processes (${staleProcessIds.join(", ")})`,
  );

  stopProcesses(staleProcessIds, "SIGTERM");
  await waitForProcessesToExit(staleProcessIds, 1500);

  const remainingProcessIds = staleProcessIds.filter(processExists);
  if (remainingProcessIds.length > 0) {
    console.error(
      `[node-run-helper] ${context}: forcing local OpenClaw shutdown (${remainingProcessIds.join(", ")})`,
    );
    stopProcesses(remainingProcessIds, "SIGKILL");
    await waitForProcessesToExit(remainingProcessIds, 1500);
  }

  const relayPortStillBusy = listListeningProcessIds(EXTENSION_RELAY_PORT).some(
    (pid) => {
      const command = getProcessCommand(pid);
      return isLocalOpenClawProcess(command);
    },
  );
  if (relayPortStillBusy) {
    throw new Error(
      `port ${EXTENSION_RELAY_PORT} is still owned by a local OpenClaw process after cleanup`,
    );
  }
}

function listListeningProcessIds(port: number): number[] {
  const output = runSystemCommand("lsof", [
    "-nP",
    `-iTCP:${port}`,
    "-sTCP:LISTEN",
    "-t",
  ]);

  return output
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function listOrphanedLocalOpenClawProcesses(): Array<{
  pid: number;
  command: string;
}> {
  const output = runSystemCommand("ps", ["-axo", "pid=,ppid=,command="]);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) {
        return null;
      }
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        command: match[3],
      };
    })
    .filter(
      (entry): entry is { pid: number; ppid: number; command: string } =>
        entry !== null,
    )
    .filter(
      (entry) => entry.ppid === 1 && isLocalOpenClawProcess(entry.command),
    )
    .map(({ pid, command }) => ({ pid, command }));
}

function getProcessCommand(pid: number): string {
  return runSystemCommand("ps", ["-p", String(pid), "-o", "command="]).trim();
}

function isLocalOpenClawProcess(command: string): boolean {
  const executable = command.trim().split(/\s+/, 1)[0] ?? "";
  const basename = executable.split("/").pop() ?? executable;
  return LOCAL_OPENCLAW_PROCESS_NAMES.has(basename);
}

function stopProcesses(processIds: number[], signal: NodeJS.Signals): void {
  for (const pid of processIds) {
    try {
      process.kill(pid, signal);
    } catch {
      // Process already exited or was never there.
    }
  }
}

function uniqueProcessIds(processIds: number[]): number[] {
  return [
    ...new Set(
      processIds.filter(
        (pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid,
      ),
    ),
  ];
}

async function waitForProcessesToExit(
  processIds: number[],
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (processIds.every((pid) => !processExists(pid))) {
      return;
    }
    await sleep(100);
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runSystemCommand(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}
