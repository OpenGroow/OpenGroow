import { runCliCommand, type CliCommandResult } from "./run-cli-command.js";

export type DockerRunResult = CliCommandResult;

// `options` is optional (unlike ComposeRunner's required `{cwd, env}`):
// broker-sync.ts's cp/restart calls never need one, while broker.ts's
// logs/status reads go through the shared runOrThrow helper (instances.ts),
// which always passes one — a DockerRunner is accepted anywhere a
// ComposeRunner is expected.
export type DockerRunner = (
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> }
) => Promise<DockerRunResult>;

// Plain `docker` CLI (not `docker compose`) — used both for broker key
// propagation (issue #307: `docker cp`/`docker restart` against the single,
// already-running broker container) and for reading the shared broker
// container's own logs/status (issue #308: `docker logs`/`docker ps`).
// Neither needs the full multi-fragment compose file context (and the
// required-env-var validation that would entail) the way per-instance
// compose invocations do.
export const defaultDockerRunner: DockerRunner = (args, options) => {
  return runCliCommand("docker", args, {
    cwd: options?.cwd,
    env: { ...process.env, ...options?.env }
  });
};
