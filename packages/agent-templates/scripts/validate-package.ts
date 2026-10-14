/**
 * `pnpm template:validate <folder> [--tag <name>@<version>]`
 *
 * Validates a Template package with the reader installation uses (#672), so a
 * Template repository (e.g. OpenGroow/groowhub) can run it in CI on every
 * package. With `--tag` it also checks the release tag against the package.
 * Exit code 0 when valid, 1 otherwise; every problem is printed.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePackageFolder } from "../src/validate-package.js";

const USAGE = "Usage: template:validate <folder> [--tag <name>@<version>]";

export function parseValidateArgs(argv: readonly string[]): { folder: string; tag?: string } {
  let folder: string | undefined;
  let tag: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--tag") tag = argv[++i];
    else folder ??= argv[i];
  }
  if (!folder) throw new Error(`${USAGE}: missing <folder>`);
  return { folder, ...(tag ? { tag } : {}) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { folder, tag } = parseValidateArgs(process.argv.slice(2));
  const result = validatePackageFolder(resolve(process.env.INIT_CWD ?? process.cwd(), folder), tag ? { tag } : {});
  if (result.ok) console.log(`OK ${result.id}@${result.version}`);
  else for (const error of result.errors) console.error(`ERROR ${folder}: ${error}`);
  process.exit(result.ok ? 0 : 1);
}
