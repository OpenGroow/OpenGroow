import type { DockerRunner } from "./default-docker-runner.js";
import type { KnownInstance } from "./registry.js";

export const COMPOSE_PROJECT_LABEL = "com.docker.compose.project";
const COMPOSE_SERVICE_LABEL = "com.docker.compose.service";
export const PROJECT_PREFIX = "openclaw-";

type DockerInspectContainer = {
  Id: string;
  Created: string;
  Config: {
    Labels?: Record<string, string>;
    Env?: string[];
  };
};

export function envValue(env: string[] | undefined, key: string): string | undefined {
  const prefix = `${key}=`;
  const value = env?.find((line) => line.startsWith(prefix))?.slice(prefix.length);
  return value ? value : undefined;
}

// Rebuilds the in-memory registry from the Compose projects this service
// itself already created — the registry (issue #305) is otherwise entirely
// in-memory and reset by every process restart, which would silently
// re-allocate an already-in-use port to a new instance and, worse, drop
// every existing instance from the very next broker key sync (issue #307),
// disconnecting them all. Reads back exactly the env vars createInstance
// originally passed to `docker compose up` (buildComposeUpEnv) via Compose's
// own project/service labels, so there's no separate persisted store to
// keep in sync with reality.
export async function discoverExistingInstances(dockerRunner: DockerRunner): Promise<KnownInstance[]> {
  const [workers, gateways] = await Promise.all([
    listContainers(dockerRunner, "openclaw-runtime-worker"),
    listContainers(dockerRunner, "openclaw-gateway"),
  ]);

  const gatewayPortByProject = new Map<string, number>();
  for (const gateway of gateways) {
    const project = gateway.Config.Labels?.[COMPOSE_PROJECT_LABEL];
    const port = envValue(gateway.Config.Env, "OPENCLAW_GATEWAY_PORT");
    if (project && port) {
      gatewayPortByProject.set(project, Number(port));
    }
  }

  const instances: KnownInstance[] = [];
  for (const worker of workers) {
    const project = worker.Config.Labels?.[COMPOSE_PROJECT_LABEL];
    if (!project || !project.startsWith(PROJECT_PREFIX)) {
      continue;
    }
    const id = envValue(worker.Config.Env, "OPENCLAW_INSTANCE_ID");
    const keyId = envValue(worker.Config.Env, "OPENCLAW_KEY_ID");
    const secret = envValue(worker.Config.Env, "OPENCLAW_SECRET");
    const port = gatewayPortByProject.get(project);
    if (!id || !keyId || !secret || port === undefined) {
      // Partial/unmatched container (e.g. its gateway sibling isn't up, or
      // it predates this instance-id scheme) — nothing safe to reconstruct,
      // so it's left out rather than guessed at.
      continue;
    }
    instances.push({ id, port, keyId, secret, createdAt: worker.Created });
  }
  return instances;
}

export async function listContainers(
  dockerRunner: DockerRunner,
  service: string
): Promise<DockerInspectContainer[]> {
  const ps = await dockerRunner([
    "ps",
    "-a",
    "--filter",
    `label=${COMPOSE_SERVICE_LABEL}=${service}`,
    "--format",
    "{{.ID}}",
  ]);
  const ids = ps.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    return [];
  }
  const inspect = await dockerRunner(["inspect", ...ids]);
  try {
    const parsed = JSON.parse(inspect.stdout) as unknown;
    return Array.isArray(parsed) ? (parsed as DockerInspectContainer[]) : [];
  } catch {
    return [];
  }
}
