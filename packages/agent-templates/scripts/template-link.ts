/**
 * `pnpm template:link <folder> --project <projectId> [-- <convex run flags>]`
 *
 * `<projectId>` is the Project id, i.e. the Instance's `openclawId`.
 *
 * Link mode (#653): the Project's installed Template follows a local folder.
 * Each save re-reads the folder, updates the registry snapshot and reconciles
 * the Instance, so authors iterate without reinstalling. An invalid edit is
 * reported and the previous valid snapshot stays in place. Self-host /
 * development only, like `template:add` (it runs an internal Convex action
 * with the deployment's admin credentials). Stop with Ctrl-C.
 */
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readPackageFolder } from "../src/package-folder.js";
import { buildConvexRunArgs, parseTemplateAddArgs } from "./template-add.js";

export const LINK_ACTION = "template_install_local:linkFromFolder";
export const LINK_USAGE = "Usage: template:link <folder> --project <projectId> [-- <convex run flags>]";
const DEBOUNCE_MS = 200;
const IGNORED_SEGMENTS = new Set([".git", "node_modules", ".DS_Store"]);

/** Whether a changed path (relative to the linked folder) is not part of the package. */
export function isIgnoredWatchPath(relativePath: string): boolean {
  return relativePath.split(/[\\/]/).some((segment) => IGNORED_SEGMENTS.has(segment));
}

/**
 * Serializes syncs: one at a time, and a request made while one runs triggers a
 * single follow-up run (so the last save always wins). A failing sync is
 * reported by `sync` itself and never stops the loop.
 */
export function createSyncLoop(sync: () => Promise<void>): { request: () => Promise<void> } {
  let current: Promise<void> | undefined;
  let again = false;

  const run = async () => {
    do {
      again = false;
      try {
        await sync();
      } catch {
        // `sync` reports its own failures; the next save retries.
      }
    } while (again);
  };

  return {
    request() {
      if (current) {
        again = true;
        return current;
      }
      current = run().finally(() => {
        current = undefined;
      });
      return current;
    },
  };
}

/**
 * A warning for a successful sync whose edit reached no Agent: the folder's
 * Template id changed since the link started (the Agent follows the old id), or
 * no active Agent uses the Template yet. `stdout` is the action's JSON result.
 */
export function linkWarning(stdout: string, linkedTemplateId: string | undefined): string | undefined {
  let result: { templateId?: unknown; reconciled?: unknown };
  try {
    result = JSON.parse(stdout) as typeof result;
  } catch {
    return undefined;
  }
  if (typeof result.templateId !== "string" || !Array.isArray(result.reconciled)) return undefined;
  if (linkedTemplateId !== undefined && result.templateId !== linkedTemplateId) {
    return `the folder's Template id changed from "${linkedTemplateId}" to "${result.templateId}": Agents of "${linkedTemplateId}" no longer follow this folder`;
  }
  if (result.reconciled.length === 0) {
    return `no active Agent uses Template "${result.templateId}" yet: activate one to see the edits in its workspace`;
  }
  return undefined;
}

function templateIdOf(stdout: string): string | undefined {
  try {
    const { templateId } = JSON.parse(stdout) as { templateId?: unknown };
    return typeof templateId === "string" ? templateId : undefined;
  } catch {
    return undefined;
  }
}

function runConvex(args: string[], cwd: string): Promise<{ status: number; stdout: string; output: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn("npx", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let output = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      output += chunk;
    });
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (error) => resolvePromise({ status: 1, stdout, output: `Failed to run npx: ${error.message}` }));
    child.on("close", (status) => resolvePromise({ status: status ?? 1, stdout, output }));
  });
}

function main(): void {
  const { folder, projectId, convexArgs } = parseTemplateAddArgs(process.argv.slice(2), LINK_USAGE);
  const root = resolve(process.env.INIT_CWD ?? process.cwd(), folder);
  const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../..");

  let linkedTemplateId: string | undefined;
  const loop = createSyncLoop(async () => {
    const stamp = new Date().toLocaleTimeString();
    try {
      const files = readPackageFolder(root);
      const { status, stdout, output } = await runConvex(
        buildConvexRunArgs(projectId, files, convexArgs, LINK_ACTION),
        repoRoot,
      );
      if (status === 0) {
        console.log(`[${stamp}] linked ${root}\n${output.trim()}`);
        const warning = linkWarning(stdout, linkedTemplateId);
        if (warning) console.warn(`[${stamp}] warning: ${warning}`);
        linkedTemplateId ??= templateIdOf(stdout);
      } else console.error(`[${stamp}] edit refused, the previous snapshot stays in place:\n${output.trim()}`);
    } catch (error) {
      console.error(`[${stamp}] ${error instanceof Error ? error.message : error}`);
    }
  });

  let timer: NodeJS.Timeout | undefined;
  watch(root, { recursive: true }, (_event, filename) => {
    if (filename && isIgnoredWatchPath(filename.toString())) return;
    clearTimeout(timer);
    timer = setTimeout(() => void loop.request(), DEBOUNCE_MS);
  });
  console.log(`Linking ${root} to Project ${projectId}. Save a file to update the Template; Ctrl-C to stop.`);
  void loop.request();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
