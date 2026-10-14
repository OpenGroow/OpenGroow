import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DockerRunner } from "./default-docker-runner.js";
import type { KnownInstance } from "./registry.js";

export type OpenClawKeyRecord = { openClawId: string; secret: string };
export type OpenClawKeyRegistry = Record<string, OpenClawKeyRecord>;

// Broker key propagation (issue #303's Implementation Decisions, wired in
// issue #307): every known local instance must be represented, keyed by its
// keyId — matches apps/broker/src/broker.ts's BROKER_OPENCLAW_KEYS_FILE
// shape.
export function buildOpenClawKeyRegistry(instances: KnownInstance[]): OpenClawKeyRegistry {
  const registry: OpenClawKeyRegistry = {};
  for (const instance of instances) {
    registry[instance.keyId] = { openClawId: instance.id, secret: instance.secret };
  }
  return registry;
}

export class BrokerSyncError extends Error {
  constructor(
    message: string,
    readonly stdout: string,
    readonly stderr: string
  ) {
    super(message);
    this.name = "BrokerSyncError";
  }
}

export type BrokerSyncDeps = {
  dockerRunner: DockerRunner;
  brokerContainer: string;
  brokerKeysFilePath: string;
};

// No new broker admin/hot-register endpoint (issue #303's Implementation
// Decisions, out of scope list): the broker only ever reads its key
// registry once at startup, so propagating a key-set change means writing
// the regenerated file directly into the broker container's filesystem
// (`docker cp` — works even though the broker's own compose mount for this
// path is read-only, since it operates at the daemon/volume level, not
// through the container's mount flags) and then restarting the container so
// it reloads.
export async function syncBrokerOpenClawKeys(
  deps: BrokerSyncDeps,
  keys: OpenClawKeyRegistry
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "openclaw-local-control-"));
  const tmpFile = join(dir, "openclaw-keys.json");
  try {
    writeFileSync(tmpFile, `${JSON.stringify(keys)}\n`, "utf8");

    const cp = await deps.dockerRunner(["cp", tmpFile, `${deps.brokerContainer}:${deps.brokerKeysFilePath}`]);
    if (cp.code !== 0) {
      throw new BrokerSyncError(
        `Failed to copy OpenClaw keys into broker container ${deps.brokerContainer}`,
        cp.stdout,
        cp.stderr
      );
    }

    const restart = await deps.dockerRunner(["restart", deps.brokerContainer]);
    if (restart.code !== 0) {
      throw new BrokerSyncError(
        `Failed to restart broker container ${deps.brokerContainer}`,
        restart.stdout,
        restart.stderr
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
