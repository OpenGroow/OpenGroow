/**
 * `opengroow-template-validate package <folder> [--tag <name>@<version>]`
 * `opengroow-template-validate index <index.json>`
 *
 * Validates a Template package, or a hub index, with the code the product runs
 * at installation (#672), so a hub repository can check every package in CI
 * without a checkout of the product. Bundled from `@opengroow/agent-templates`.
 * Exit code 0 when valid, 1 otherwise; every problem is printed.
 */
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHubIndex } from "../../agent-templates/src/hub-index.js";
import { validatePackageFolder } from "../../agent-templates/src/validate-package.js";

const USAGE = `Usage:
  opengroow-template-validate package <folder> [--tag <name>@<version>]
  opengroow-template-validate index <index.json>`;

export type ValidateCommand =
  | { command: "package"; folder: string; tag?: string }
  | { command: "index"; file: string };

export function parseArgs(argv: readonly string[]): ValidateCommand {
  const [command, ...rest] = argv;
  if (command === "package") {
    let folder: string | undefined;
    let tag: string | undefined;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--tag") {
        tag = rest[++i];
        if (!tag) throw new Error(`${USAGE}\n\n--tag needs a value`);
      } else folder ??= rest[i];
    }
    if (!folder) throw new Error(`${USAGE}\n\nmissing <folder>`);
    return { command, folder, ...(tag ? { tag } : {}) };
  }
  if (command === "index") {
    if (!rest[0]) throw new Error(`${USAGE}\n\nmissing <index.json>`);
    return { command, file: rest[0] };
  }
  throw new Error(USAGE);
}

/** Runs one command and returns the exit code; output goes through `log`/`error`. */
export function run(
  argv: readonly string[],
  io: { cwd: string; log: (line: string) => void; error: (line: string) => void },
): number {
  let parsed: ValidateCommand;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (parsed.command === "package") {
    const result = validatePackageFolder(resolve(io.cwd, parsed.folder), parsed.tag ? { tag: parsed.tag } : {});
    if (result.ok) io.log(`OK ${result.id}@${result.version}`);
    else for (const error of result.errors) io.error(`ERROR ${parsed.folder}: ${error}`);
    return result.ok ? 0 : 1;
  }

  let json: unknown;
  try {
    json = JSON.parse(readFileSync(resolve(io.cwd, parsed.file), "utf-8"));
  } catch (error) {
    io.error(`ERROR ${parsed.file}: ${error instanceof Error ? error.message : error}`);
    return 1;
  }
  const index = parseHubIndex(json);
  if (index.ok) io.log(`OK ${index.index.packages.length} package(s)`);
  else io.error(`ERROR ${parsed.file}: ${index.reason}`);
  return index.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  process.exit(run(process.argv.slice(2), { cwd: process.cwd(), log: console.log, error: console.error }));
}
