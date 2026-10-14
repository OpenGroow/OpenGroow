import type { ComposeRunner } from "./compose-runner.js";
import { runCliCommand } from "./run-cli-command.js";

// Shells out to `docker compose`: directly on the host under `pnpm dev`, or
// from the `pnpm start` container through the mounted Docker socket (root-
// equivalent power, required to create every Project's containers; see
// docs/START.md).
export const defaultComposeRunner: ComposeRunner = (args, options) => {
  return runCliCommand("docker", ["compose", ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env }
  });
};
