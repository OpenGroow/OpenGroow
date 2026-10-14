import { execFile } from "node:child_process";

export type CliCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

// Shared by defaultComposeRunner (`docker compose ...`) and
// defaultDockerRunner (`docker ...`) — both just need exit code/stdout/
// stderr from a host CLI invocation, never a thrown exception on a
// non-zero exit.
export function runCliCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env: Record<string, string | undefined> }
): Promise<CliCommandResult> {
  return new Promise((resolvePromise) => {
    execFile(command, args, { cwd: options.cwd, env: options.env }, (error, stdout, stderr) => {
      if (!error) {
        resolvePromise({ code: 0, stdout, stderr });
        return;
      }
      const exitCode = (error as NodeJS.ErrnoException & { code?: unknown }).code;
      const code = typeof exitCode === "number" ? exitCode : 1;
      resolvePromise({ code, stdout, stderr });
    });
  });
}
