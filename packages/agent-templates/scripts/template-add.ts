/**
 * `pnpm template:add <folder> --project <projectId> [-- <convex run flags>]`
 *
 * `<projectId>` is the Project id, i.e. the Instance's `openclawId`.
 *
 * Installs a Claw package from a local folder into a Project of a self-hosted
 * or development deployment (#652), then reconciles the Instance from the
 * registry. Self-host / development only: it calls an internal Convex action
 * through `npx convex run`, i.e. with the deployment's admin credentials, which
 * is the identity-free path (the public install needs a Project owner's
 * session). A Project id is the Instance's `openclawId`.
 *
 * Everything after `--` is forwarded to `convex run`, to pick the deployment
 * (`--url`, `--admin-key`, `--prod`, ...).
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readPackageFolder, type PackageFile } from "../src/package-folder.js";

export const ADD_ACTION = "template_install_local:addFromFolder";

export type TemplateAddArgs = { folder: string; projectId: string; convexArgs: string[] };

const USAGE = "Usage: template:add <folder> --project <projectId> [-- <convex run flags>]";

export function parseTemplateAddArgs(argv: readonly string[], usage: string = USAGE): TemplateAddArgs {
  const separator = argv.indexOf("--");
  const own = separator === -1 ? [...argv] : argv.slice(0, separator);
  const convexArgs = separator === -1 ? [] : argv.slice(separator + 1);

  let folder: string | undefined;
  let projectId: string | undefined;
  for (let i = 0; i < own.length; i++) {
    if (own[i] === "--project") projectId = own[++i];
    else folder ??= own[i];
  }
  if (!folder) throw new Error(`${usage}: missing <folder>`);
  if (!projectId) throw new Error(`${usage}: missing --project`);
  return { folder, projectId, convexArgs };
}

/** `npx` arguments running the install action; the package travels as the JSON argument. */
export function buildConvexRunArgs(
  projectId: string,
  files: readonly PackageFile[],
  convexArgs: readonly string[],
  action: string = ADD_ACTION,
): string[] {
  return ["convex", "run", action, JSON.stringify({ projectId, files }), ...convexArgs];
}

function main(): void {
  const { folder, projectId, convexArgs } = parseTemplateAddArgs(process.argv.slice(2));
  const files = readPackageFolder(resolve(process.env.INIT_CWD ?? process.cwd(), folder));
  const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../..");
  const result = spawnSync("npx", buildConvexRunArgs(projectId, files, convexArgs), { cwd: repoRoot, stdio: "inherit" });
  if (result.error) console.error(`Failed to run npx: ${result.error.message}`);
  process.exit(result.status ?? 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
