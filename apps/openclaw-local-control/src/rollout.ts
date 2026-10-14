import { buildComposeArgs, buildComposeUpEnv } from "./compose.js";
import type { ComposeRunner } from "./compose-runner.js";
import type { LocalControlConfig } from "./config.js";
import {
  COMPOSE_PROJECT_LABEL,
  PROJECT_PREFIX,
  envValue,
  listContainers,
} from "./discover-instances.js";
import type { DockerRunner } from "./default-docker-runner.js";
import type { InstanceCredentials } from "./ids.js";

export type RolloutDeps = {
  config: LocalControlConfig;
  composeRunner: ComposeRunner;
  dockerRunner: DockerRunner;
};

export type RolloutResult = {
  id: string;
  ok: boolean;
  error?: string;
};

// Recreates every existing local instance's Compose project against
// whatever image `config.gatewayImageRef`/`runtimeWorkerImageRef` currently
// resolve to (e.g. after `pnpm openclaw:local` retags `:local`) — the
// local-multi equivalent of the remote control-plane's fleet rollout (see
// instance_provisioning/local.ts's `rollout`, previously "not supported
// yet"). `docker compose up -d` only recreates a service whose image
// actually changed, and this project's per-instance volume namespacing
// (compose.ts's composeProjectName) is untouched by `up` — so workspace/
// config state survives, unlike `down -v` + create.
//
// There is no persisted store of each instance's original credentials
// (registry.ts resets on every process restart, same as
// discoverExistingInstances) — they're read back from the instance's own
// running containers via `docker inspect`, the same technique
// discoverExistingInstances uses to reseed the registry, extended here to
// also recover OPENCLAW_GATEWAY_TOKEN (needed to rebuild the full
// buildComposeUpEnv, not just the registry's narrower KnownInstance shape).
export async function rolloutInstances(deps: RolloutDeps): Promise<RolloutResult[]> {
  const instances = await discoverInstanceCredentials(deps.dockerRunner);
  const results: RolloutResult[] = [];
  for (const instance of instances) {
    const upArgs = buildComposeArgs(deps.config, instance.id, "up");
    const upEnv = buildComposeUpEnv(deps.config, instance.id, instance.port, {
      keyId: instance.keyId,
      secret: instance.secret,
      gatewayToken: instance.gatewayToken,
    });
    const result = await deps.composeRunner(upArgs, {
      cwd: deps.config.dockerDir,
      env: upEnv,
    });
    results.push(
      result.code === 0
        ? { id: instance.id, ok: true }
        : {
            id: instance.id,
            ok: false,
            error: result.stderr || result.stdout || `docker compose up exited with code ${result.code}`,
          },
    );
  }
  return results;
}

type DiscoveredCredentials = { id: string; port: number } & InstanceCredentials;

async function discoverInstanceCredentials(dockerRunner: DockerRunner): Promise<DiscoveredCredentials[]> {
  const [workers, gateways] = await Promise.all([
    listContainers(dockerRunner, "openclaw-runtime-worker"),
    listContainers(dockerRunner, "openclaw-gateway"),
  ]);

  const gatewayByProject = new Map<string, { port: number; gatewayToken: string }>();
  for (const gateway of gateways) {
    const project = gateway.Config.Labels?.[COMPOSE_PROJECT_LABEL];
    const port = envValue(gateway.Config.Env, "OPENCLAW_GATEWAY_PORT");
    const gatewayToken = envValue(gateway.Config.Env, "OPENCLAW_GATEWAY_TOKEN");
    if (project && port && gatewayToken) {
      gatewayByProject.set(project, { port: Number(port), gatewayToken });
    }
  }

  const instances: DiscoveredCredentials[] = [];
  for (const worker of workers) {
    const project = worker.Config.Labels?.[COMPOSE_PROJECT_LABEL];
    if (!project || !project.startsWith(PROJECT_PREFIX)) {
      continue;
    }
    const id = envValue(worker.Config.Env, "OPENCLAW_INSTANCE_ID");
    const keyId = envValue(worker.Config.Env, "OPENCLAW_KEY_ID");
    const secret = envValue(worker.Config.Env, "OPENCLAW_SECRET");
    const gateway = gatewayByProject.get(project);
    if (!id || !keyId || !secret || !gateway) {
      // Partial/unmatched container — nothing safe to reconstruct, same
      // rule as discoverExistingInstances.
      continue;
    }
    instances.push({ id, port: gateway.port, keyId, secret, gatewayToken: gateway.gatewayToken });
  }
  return instances;
}
