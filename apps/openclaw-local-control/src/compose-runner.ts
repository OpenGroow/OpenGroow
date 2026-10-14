export type ComposeRunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type ComposeRunner = (
  args: string[],
  options: { cwd: string; env: Record<string, string> }
) => Promise<ComposeRunResult>;
