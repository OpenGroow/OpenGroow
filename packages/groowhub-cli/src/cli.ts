/**
 * `groowhub validate template <folder> [--tag <name>@<version>]`
 * `groowhub validate index <index.json> [--kind publisher]`
 * `groowhub validate publisher <folder>` / `validate analytics <folder>`
 * `groowhub pack publisher <folder> --out <dir> [--index <publishers.json>]` / `pack analytics` (`analytics.json`)
 *
 * The tooling of the hub repository (groowhub): it checks and builds what the
 * hub distributes with the code the product runs at installation, so a hub can
 * validate and release every package in CI without a checkout of the product.
 * Bundled from `@opengroow/agent-templates` and `@opengroow/publisher-sdk`.
 * Exit code 0 when valid, 1 otherwise; every problem is printed.
 */
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHubIndex, parseHubPackageIndex } from "../../agent-templates/src/hub-index.js";
import { validatePackageFolder } from "../../agent-templates/src/validate-package.js";
import { checkPublisherFolder, packPublisher } from "./publisher.js";
import { checkAnalyticsFolder, packAnalytics } from "./analytics.js";

const USAGE = `Usage:
  groowhub validate template <folder> [--tag <name>@<version>]
  groowhub validate index <index.json> [--kind publisher|analytics]
  groowhub validate publisher <folder>
  groowhub validate analytics <folder>
  groowhub pack publisher <folder> --out <dir> [--index <publishers.json>]
  groowhub pack analytics <folder> --out <dir> [--index <analytics.json>]`;

export type Command =
  | { command: "validate-template"; folder: string; tag?: string }
  | { command: "validate-index"; file: string; kind: "template" | "publisher" | "analytics" }
  | { command: "validate-publisher"; folder: string }
  | { command: "validate-analytics"; folder: string }
  | { command: "pack-publisher"; folder: string; out: string; index?: string }
  | { command: "pack-analytics"; folder: string; out: string; index?: string };

function flags(rest: readonly string[], names: readonly string[]): { positional: string[]; values: Record<string, string> } {
  const positional: string[] = [];
  const values: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg.startsWith("--")) {
      if (!names.includes(arg)) throw new Error(`${USAGE}\n\nunknown option ${arg}`);
      const value = rest[++i];
      if (!value) throw new Error(`${USAGE}\n\n${arg} needs a value`);
      values[arg] = value;
    } else positional.push(arg);
  }
  return { positional, values };
}

export function parseArgs(argv: readonly string[]): Command {
  const [verb, noun, ...rest] = argv;
  if (verb === "validate" && noun === "template") {
    const { positional, values } = flags(rest, ["--tag"]);
    if (!positional[0]) throw new Error(`${USAGE}\n\nmissing <folder>`);
    return { command: "validate-template", folder: positional[0], ...(values["--tag"] ? { tag: values["--tag"] } : {}) };
  }
  if (verb === "validate" && noun === "index") {
    const { positional, values } = flags(rest, ["--kind"]);
    if (!positional[0]) throw new Error(`${USAGE}\n\nmissing <index.json>`);
    const kind = values["--kind"] ?? "template";
    if (kind !== "template" && kind !== "publisher" && kind !== "analytics") throw new Error(`${USAGE}\n\nunknown kind ${kind}`);
    return { command: "validate-index", file: positional[0], kind };
  }
  if (verb === "validate" && (noun === "publisher" || noun === "analytics")) {
    const { positional } = flags(rest, []);
    if (!positional[0]) throw new Error(`${USAGE}\n\nmissing <folder>`);
    return { command: noun === "publisher" ? "validate-publisher" : "validate-analytics", folder: positional[0] };
  }
  if (verb === "pack" && (noun === "publisher" || noun === "analytics")) {
    const { positional, values } = flags(rest, ["--out", "--index"]);
    if (!positional[0]) throw new Error(`${USAGE}\n\nmissing <folder>`);
    if (!values["--out"]) throw new Error(`${USAGE}\n\nmissing --out <dir>`);
    return {
      command: noun === "publisher" ? "pack-publisher" : "pack-analytics",
      folder: positional[0],
      out: values["--out"],
      ...(values["--index"] ? { index: values["--index"] } : {}),
    };
  }
  throw new Error(USAGE);
}

/** Runs one command and returns the exit code; output goes through `log`/`error`. */
export function run(
  argv: readonly string[],
  io: { cwd: string; log: (line: string) => void; error: (line: string) => void },
): number {
  let parsed: Command;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (parsed.command === "validate-template") {
    const result = validatePackageFolder(resolve(io.cwd, parsed.folder), parsed.tag ? { tag: parsed.tag } : {});
    if (result.ok) io.log(`OK ${result.id}@${result.version}`);
    else for (const error of result.errors) io.error(`ERROR ${parsed.folder}: ${error}`);
    return result.ok ? 0 : 1;
  }

  if (parsed.command === "validate-publisher" || parsed.command === "pack-publisher" || parsed.command === "validate-analytics" || parsed.command === "pack-analytics") {
    const dir = resolve(io.cwd, parsed.folder);
    const analytics = parsed.command.endsWith("analytics");
    try {
      if (parsed.command === "validate-publisher" || parsed.command === "validate-analytics") {
        const { pkg } = analytics ? checkAnalyticsFolder(dir) : checkPublisherFolder(dir);
        io.log(`OK ${pkg.name}@${pkg.version}`);
      } else {
        const pack = analytics ? packAnalytics : packPublisher;
        const result = pack(dir, resolve(io.cwd, parsed.out), parsed.index ? { indexFile: resolve(io.cwd, parsed.index) } : {});
        io.log(`${result.file}`);
        io.log(`${result.tag} ${result.digest}`);
      }
      return 0;
    } catch (error) {
      io.error(`ERROR ${parsed.folder}: ${error instanceof Error ? error.message : error}`);
      return 1;
    }
  }

  let json: unknown;
  try {
    json = JSON.parse(readFileSync(resolve(io.cwd, parsed.file), "utf-8"));
  } catch (error) {
    io.error(`ERROR ${parsed.file}: ${error instanceof Error ? error.message : error}`);
    return 1;
  }
  if (parsed.kind === "publisher" || parsed.kind === "analytics") {
    const index = parseHubPackageIndex(json);
    if (index.ok) io.log(`OK ${index.index.packages.length} package(s)`);
    else io.error(`ERROR ${parsed.file}: ${index.reason}`);
    return index.ok ? 0 : 1;
  }
  const index = parseHubIndex(json);
  if (index.ok) io.log(`OK ${index.index.packages.length} package(s)`);
  else io.error(`ERROR ${parsed.file}: ${index.reason}`);
  return index.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  process.exit(run(process.argv.slice(2), { cwd: process.env.INIT_CWD ?? process.cwd(), log: console.log, error: console.error }));
}
