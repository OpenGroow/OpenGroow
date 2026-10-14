import { normalizeTail } from "./compose.js";
import { runOrThrow } from "./instances.js";
import type { DockerRunner } from "./default-docker-runner.js";

// Issue #308: self-host runs exactly one shared broker container (the root
// docker-compose.yml's `broker` service), never one per instance — unlike
// openclaw-gateway/openclaw-runtime-worker, it isn't part of any
// per-instance compose project this service manages, so it's addressed by
// plain `docker logs`/`docker ps`, not `docker compose`. Mirrors the remote control-plane's
// readBrokerLogs/readBrokerStatus (SSH + plain `docker logs`/`docker ps`
// against its own single broker host).
export async function readBrokerLogs(
  dockerRunner: DockerRunner,
  containerName: string,
  tail?: number
): Promise<string> {
  const safeTail = normalizeTail(tail, 300);
  return runOrThrow(
    dockerRunner,
    ["logs", "--tail", String(safeTail), containerName],
    { cwd: process.cwd(), env: {} },
    `docker logs failed for broker container ${containerName}`
  );
}

export async function readBrokerStatus(
  dockerRunner: DockerRunner,
  containerName: string
): Promise<string> {
  return runOrThrow(
    dockerRunner,
    ["ps", "--filter", `name=${containerName}`],
    { cwd: process.cwd(), env: {} },
    `docker ps failed for broker container ${containerName}`
  );
}
