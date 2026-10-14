/**
 * `pnpm template:add-git <owner/repo | github url> --tag <tag> [--asset <file.tgz>] --digest sha256:<hex> --project <projectId> [-- <convex run flags>]`
 *
 * `<projectId>` is the Project id, i.e. the Instance's `openclawId`.
 *
 * Installs a Claw package from a Git release (#667): downloads the tag's
 * archive, verifies its sha256 against `--digest` (a mismatch refuses the
 * install before anything is sent), then installs it through the internal
 * Convex action, which records the Git origin on the Template and reconciles
 * the Instance. Self-host / development only, like `template:add`.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchGitPackage, type FetchLike, type GitOrigin } from "../src/git-archive.js";
import type { PackageFile } from "../src/package-folder.js";

export const ADD_GIT_ACTION = "template_install_local:addFromGit";
const USAGE =
  "Usage: template:add-git <owner/repo> --tag <tag> [--asset <file.tgz>] --digest sha256:<hex> --project <projectId> [-- <convex run flags>]";

export type TemplateAddGitArgs = {
  repository: string;
  tag: string;
  /** Release asset (`*.tgz`) to install instead of the tag's source archive (#672). */
  asset?: string;
  digest: string;
  projectId: string;
  convexArgs: string[];
};

export function parseTemplateAddGitArgs(argv: readonly string[]): TemplateAddGitArgs {
  const separator = argv.indexOf("--");
  const own = separator === -1 ? [...argv] : argv.slice(0, separator);
  const convexArgs = separator === -1 ? [] : argv.slice(separator + 1);

  const flags: Record<string, string | undefined> = {};
  let repository: string | undefined;
  for (let i = 0; i < own.length; i++) {
    const arg = own[i]!;
    if (arg === "--tag" || arg === "--asset" || arg === "--digest" || arg === "--project") flags[arg] = own[++i];
    else repository ??= arg;
  }
  if (!repository) throw new Error(`${USAGE}: missing <repository>`);
  if (!flags["--tag"]) throw new Error(`${USAGE}: missing --tag`);
  if (!flags["--digest"]) throw new Error(`${USAGE}: missing --digest`);
  if (!flags["--project"]) throw new Error(`${USAGE}: missing --project`);
  return { repository, tag: flags["--tag"], ...(flags["--asset"] ? { asset: flags["--asset"] } : {}), digest: flags["--digest"], projectId: flags["--project"], convexArgs };
}

/** `npx` arguments running the Git install action; the package and its origin travel as the JSON argument. */
export function buildConvexRunGitArgs(
  projectId: string,
  files: readonly PackageFile[],
  gitOrigin: GitOrigin,
  convexArgs: readonly string[],
): string[] {
  return ["convex", "run", ADD_GIT_ACTION, JSON.stringify({ projectId, files, gitOrigin }), ...convexArgs];
}

/** Downloads and verifies the release, then hands it to `run`. Nothing is run when the digest does not match. */
export async function installFromGit(
  args: TemplateAddGitArgs,
  deps: { fetch: FetchLike; run: (npxArgs: string[]) => number },
): Promise<number> {
  const { files, gitOrigin } = await fetchGitPackage({ ...args, fetch: deps.fetch });
  return deps.run(buildConvexRunGitArgs(args.projectId, files, gitOrigin, args.convexArgs));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../..");
  installFromGit(parseTemplateAddGitArgs(process.argv.slice(2)), {
    fetch: (url) => fetch(url),
    run: (npxArgs) => {
      const result = spawnSync("npx", npxArgs, { cwd: repoRoot, stdio: "inherit" });
      if (result.error) console.error(`Failed to run npx: ${result.error.message}`);
      return result.status ?? 1;
    },
  }).then(
    (status) => process.exit(status),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
