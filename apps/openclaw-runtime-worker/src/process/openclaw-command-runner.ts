import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

export type OpenClawCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
};

export type SpawnLike = (
  command: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    stdio: ["ignore", "pipe", "pipe"];
  },
) => ChildProcessWithoutNullStreams;

export class OpenClawCommandRunner {
  constructor(
    private readonly spawnImpl: SpawnLike = spawn as SpawnLike,
    private readonly terminateGraceMs = 2_000,
  ) {}

  async runOpenClawCommand(
    args: string[],
    timeoutMs: number,
  ): Promise<OpenClawCommandResult> {
    return await new Promise((resolve, reject) => {
      const child = this.spawnImpl("openclaw", args, {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;
      let requiredSigkill = false;

      const cleanup = () => {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
        if (killTimer) {
          clearTimeout(killTimer);
        }
      };

      const settle = (fn: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        fn();
      };

      let killTimer: NodeJS.Timeout | null = null;
      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => {
          requiredSigkill = true;
          child.kill("SIGKILL");
        }, this.terminateGraceMs);
      }, timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (error) => {
        settle(() => reject(error));
      });

      child.on("close", (code, signal) => {
        if (timedOut) {
          const terminationMode = requiredSigkill ? "SIGKILL" : "SIGTERM";
          settle(() =>
            reject(
              new Error(
                `openclaw ${args[0] ?? ""} timed out after ${timeoutMs}ms and exited after ${terminationMode}${signal ? ` (${signal})` : ""}`,
              ),
            ),
          );
          return;
        }

        settle(() =>
          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: typeof code === "number" ? code : null,
            signal,
          }),
        );
      });
    });
  }
}
