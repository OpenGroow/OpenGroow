import type { ComposeRunner } from "./compose-runner.js";
import type { LocalControlConfig } from "./config.js";
import { buildComposeArgs, buildComposeUpEnv } from "./compose.js";
import { generateCredentials, generateInstanceId } from "./ids.js";
import { allocatePort } from "./port-allocator.js";
import type { InstanceRegistry } from "./registry.js";

export type CreatedInstance = {
  id: string;
  port: number;
  keyId: string;
  secret: string;
  gatewayToken: string;
  createdAt: string;
};

export class ComposeCommandError extends Error {
  constructor(
    message: string,
    readonly stdout: string,
    readonly stderr: string
  ) {
    super(message);
    this.name = "ComposeCommandError";
  }
}

export type ComposeDeps = {
  config: LocalControlConfig;
  registry: InstanceRegistry;
  composeRunner: ComposeRunner;
};

// Shared by every read-only docker/docker-compose invocation (issue #308's
// readInstanceLogs/readInstanceStatus below, and broker.ts's
// readBrokerLogs/readBrokerStatus): run the command, throw
// ComposeCommandError with a caller-supplied message on a non-zero exit,
// otherwise return stdout. create/removeInstance above keep their own
// inline check — they each do extra work around it (rollback, registry
// mutation) that this helper doesn't need to know about.
export async function runOrThrow(
  runner: ComposeRunner,
  args: string[],
  options: { cwd: string; env: Record<string, string> },
  errorMessage: string
): Promise<string> {
  const result = await runner(args, options);
  if (result.code !== 0) {
    throw new ComposeCommandError(`${errorMessage} (exit code ${result.code})`, result.stdout, result.stderr);
  }
  return result.stdout;
}

// Allocates a port, generates an id/credentials, and launches an isolated
// Compose project for the new instance. If the `up` invocation fails, tears
// down whatever was created (`down -v`) before re-throwing — issue #305's
// "partial-failure rollback" acceptance criterion.
//
// The port is reserved in the registry *before* the `await` on `composeRunner`
// (synchronously, right after allocatePort) so two concurrent createInstance
// calls can't both read the same usedPorts() snapshot and pick the same port —
// Node has no other yield point between allocation and reservation.
export async function createInstance(deps: ComposeDeps): Promise<CreatedInstance> {
  const { config, registry, composeRunner } = deps;
  const port = allocatePort(registry.usedPorts(), config.basePort);
  const id = generateInstanceId();
  const credentials = generateCredentials();
  const createdAt = new Date().toISOString();

  registry.add({ id, port, keyId: credentials.keyId, secret: credentials.secret, createdAt });

  const upArgs = buildComposeArgs(config, id, "up");
  const upEnv = buildComposeUpEnv(config, id, port, credentials);
  const result = await composeRunner(upArgs, { cwd: config.dockerDir, env: upEnv });

  if (result.code !== 0) {
    registry.remove(id);
    await rollback(deps, id);
    throw new ComposeCommandError(
      `docker compose up failed for instance ${id} (exit code ${result.code})`,
      result.stdout,
      result.stderr
    );
  }

  return { id, port, createdAt, ...credentials };
}

async function rollback(deps: ComposeDeps, id: string): Promise<void> {
  const downArgs = buildComposeArgs(deps.config, id, "down");
  const result = await deps.composeRunner(downArgs, { cwd: deps.config.dockerDir, env: {} });
  if (result.code !== 0) {
    // Best-effort cleanup after an already-failing `up` — surface it loudly
    // instead of swallowing it, since a failed `down -v` here leaves orphaned
    // containers/volumes that won't show up anywhere else.
    console.error(
      `[openclaw-local-control] rollback failed for instance ${id} (exit code ${result.code}): ${result.stderr}`
    );
  }
}

export type RemoveInstanceResult = { removed: true };

// Tears down containers and volumes for exactly this instance, scoped by
// its own Compose project name — no other instance's compose project is
// touched (issue #305's isolation acceptance criterion).
export async function removeInstance(
  deps: ComposeDeps,
  id: string
): Promise<RemoveInstanceResult> {
  const { config, registry, composeRunner } = deps;
  const downArgs = buildComposeArgs(config, id, "down");
  const result = await composeRunner(downArgs, { cwd: config.dockerDir, env: {} });

  if (result.code !== 0) {
    throw new ComposeCommandError(
      `docker compose down failed for instance ${id} (exit code ${result.code})`,
      result.stdout,
      result.stderr
    );
  }

  registry.remove(id);
  return { removed: true };
}

// Issue #308: `docker compose logs`, scoped to exactly this instance's own
// Compose project — mirrors the remote control-plane's readOpenClawLogs (SSH + `docker
// compose logs`), just run locally against the compose project instead of
// over SSH against a remote host.
export async function readInstanceLogs(
  deps: ComposeDeps,
  id: string,
  options: { tail?: number; service?: string }
): Promise<string> {
  const { config, composeRunner } = deps;
  const args = buildComposeArgs(config, id, "logs", options);
  return runOrThrow(
    composeRunner,
    args,
    { cwd: config.dockerDir, env: {} },
    `docker compose logs failed for instance ${id}`
  );
}

// Issue #308: `docker compose ps`, scoped to exactly this instance's own
// Compose project — mirrors the remote control-plane's readOpenClawStatus (SSH + `docker
// compose ps`).
export async function readInstanceStatus(deps: ComposeDeps, id: string): Promise<string> {
  const { config, composeRunner } = deps;
  const args = buildComposeArgs(config, id, "ps");
  return runOrThrow(
    composeRunner,
    args,
    { cwd: config.dockerDir, env: {} },
    `docker compose ps failed for instance ${id}`
  );
}
