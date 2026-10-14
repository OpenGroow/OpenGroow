/**
 * Installs a machine-side tool on the machine the code runs on (#726): the
 * user's own computer, i.e. the paired node, never the Instance's container.
 *
 * The plan is what the user consents to; the installer runs exactly the plan's
 * commands (one source of truth for "shown" and "executed"). Everything that
 * touches the machine goes through `MachineToolPorts`, so the flow is tested
 * without a machine and the node supplies the real ports
 * (`machine-tool-node-ports.ts`).
 *
 * Failure contract: on any failure or refusal the machine is left as it was.
 * The previous install (update case) is moved aside, not deleted, until the new
 * one passes its version check; it is restored on failure. The tool is
 * installed in its final directory (a Python venv bakes absolute paths in, so
 * it cannot be staged elsewhere and renamed).
 *
 * Node-only (uses `node:crypto`): not importable from the Convex runtime.
 */
import { createHash } from "node:crypto";
import type { MachineToolInstall } from "./machine-tool";
import type { MachinePrerequisite } from "./types";

export type RunResult = { code: number; output: string };

export type MachineToolPorts = {
  /** Directory holding every tool, e.g. `~/.opengroow/tools`. */
  toolsRoot: string;
  download(url: string): Promise<Uint8Array>;
  fs: {
    exists(path: string): Promise<boolean>;
    mkdir(path: string): Promise<void>;
    write(path: string, bytes: Uint8Array): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    /** Recursive, no error when absent. */
    remove(path: string): Promise<void>;
  };
  /** Runs an argv with no shell. */
  run(argv: string[]): Promise<RunResult>;
};

export type MachineToolInstallPlan = {
  name: string;
  id: string;
  dir: string;
  source: { url: string; sha256: string };
  requires: { name: string; command: string[]; instructionsUrl: string }[];
  /** Extraction, then the declared bootstrap, with `{dir}` resolved. */
  steps: { label: string; run: string[] }[];
  versionCheck?: { run: string[]; pattern?: string; minVersion?: string };
  /** Read-only listings run before extraction: entry names, then entry types. */
  archiveChecks: { names: string[]; types: string[] };
  downloadDir: string;
  archivePath: string;
};

export type MachineToolConsent = { confirm(plan: MachineToolInstallPlan): Promise<boolean> };

export type MachineToolInstallResult =
  | { status: "installed"; dir: string; version?: string }
  | { status: "refused" }
  | { status: "prerequisite-missing"; missing: { name: string; instructionsUrl: string }[] }
  | { status: "failed"; step: string; message: string };

const resolve = (argv: string[], dir: string) => argv.map((arg) => arg.replaceAll("{dir}", dir));

/** The plan shown to the user: source, requirements, and the exact commands. */
export function planMachineToolInstall(
  prerequisite: MachinePrerequisite,
  toolsRoot: string,
): MachineToolInstallPlan | undefined {
  const install: MachineToolInstall | undefined = prerequisite.install;
  if (!install) return undefined;
  const root = toolsRoot.replace(/\/+$/, "");
  const dir = `${root}/${install.id}`;
  const downloadDir = `${root}/.${install.id}.download`;
  const archivePath = `${downloadDir}/archive.tgz`;
  return {
    name: prerequisite.name,
    id: install.id,
    dir,
    source: { ...install.source },
    requires: (install.requires ?? []).map((r) => ({ name: r.name, command: r.check, instructionsUrl: r.instructionsUrl })),
    steps: [
      { label: "Extract the archive", run: ["tar", "-xzf", archivePath, "-C", dir] },
      ...(install.bootstrap ?? []).map((s) => ({ label: s.label, run: resolve(s.run, dir) })),
    ],
    ...(install.versionCheck
      ? {
          versionCheck: {
            run: resolve(install.versionCheck.run, dir),
            ...(install.versionCheck.pattern ? { pattern: install.versionCheck.pattern } : {}),
            ...(prerequisite.minVersion ? { minVersion: prerequisite.minVersion } : {}),
          },
        }
      : {}),
    archiveChecks: { names: ["tar", "-tzf", archivePath], types: ["tar", "-tvzf", archivePath] },
    downloadDir,
    archivePath,
  };
}

/** A problem with the archive's entries (unsafe path or link), or undefined. */
function archiveProblem(names: string, types: string): string | undefined {
  for (const name of names.split("\n").filter(Boolean)) {
    if (name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.split(/[\\/]/).includes("..")) {
      return `unsafe entry path "${name}"`;
    }
  }
  for (const line of types.split("\n").filter(Boolean)) {
    if (!"-d".includes(line[0]!)) return `link or special entry: ${line.trim()}`;
  }
  return undefined;
}

function parseVersion(output: string, pattern?: string): string | undefined {
  const match = new RegExp(pattern ?? "(\\d+(?:\\.\\d+)+)").exec(output);
  return match?.[1] ?? (pattern ? undefined : match?.[0]);
}

/** Numeric dotted comparison: -1, 0 or 1. Missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

const tail = (output: string) => output.trim().split("\n").slice(-5).join("\n");

class StepFailure extends Error {
  constructor(
    readonly step: string,
    message: string,
  ) {
    super(message);
  }
}

export async function installMachineTool(
  plan: MachineToolInstallPlan,
  consent: MachineToolConsent,
  ports: MachineToolPorts,
): Promise<MachineToolInstallResult> {
  if (!(await consent.confirm(plan))) return { status: "refused" };

  const missing: { name: string; instructionsUrl: string }[] = [];
  for (const requirement of plan.requires) {
    const check = await ports.run(requirement.command).catch(() => ({ code: 127, output: "" }));
    if (check.code !== 0) missing.push({ name: requirement.name, instructionsUrl: requirement.instructionsUrl });
  }
  if (missing.length > 0) return { status: "prerequisite-missing", missing };

  const previous = `${plan.dir}.previous`;
  let movedPrevious = false;
  let createdDir = false;
  let version: string | undefined;
  try {
    const bytes = await ports.download(plan.source.url).catch((error: unknown) => {
      throw new StepFailure("Download", `could not download ${plan.source.url}: ${String(error)}`);
    });
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== plan.source.sha256) {
      throw new StepFailure("Verify the download", `sha256 mismatch: expected ${plan.source.sha256}, got ${actual}; nothing was installed`);
    }
    await ports.fs.mkdir(plan.downloadDir);
    await ports.fs.write(plan.archivePath, bytes);

    const listed = await ports.run(plan.archiveChecks.names);
    const typed = listed.code === 0 ? await ports.run(plan.archiveChecks.types) : listed;
    if (listed.code !== 0 || typed.code !== 0) {
      throw new StepFailure("Check the archive", `could not list the archive: ${tail(typed.output)}`);
    }
    const unsafe = archiveProblem(listed.output, typed.output);
    if (unsafe) throw new StepFailure("Check the archive", `${unsafe}; nothing was installed`);

    const dirExists = await ports.fs.exists(plan.dir);
    if (await ports.fs.exists(previous)) {
      if (dirExists) {
        throw new StepFailure(
          "Check for an interrupted install",
          `${previous} is left over from an interrupted run and ${plan.dir} also exists; nothing was changed. Keep the one you want in ${plan.dir}, delete the other, and retry`,
        );
      }
      await ports.fs.rename(previous, plan.dir);
    }
    if (await ports.fs.exists(plan.dir)) {
      await ports.fs.rename(plan.dir, previous);
      movedPrevious = true;
    }
    await ports.fs.mkdir(plan.dir);
    createdDir = true;

    for (const step of plan.steps) {
      const result = await ports.run(step.run);
      if (result.code !== 0) throw new StepFailure(step.label, `${step.run.join(" ")} exited with ${result.code}: ${tail(result.output)}`);
    }

    if (plan.versionCheck) {
      const result = await ports.run(plan.versionCheck.run);
      if (result.code !== 0) throw new StepFailure("Check the version", `${plan.versionCheck.run.join(" ")} exited with ${result.code}: ${tail(result.output)}`);
      version = parseVersion(result.output, plan.versionCheck.pattern);
      if (plan.versionCheck.minVersion && (!version || compareVersions(version, plan.versionCheck.minVersion) < 0)) {
        throw new StepFailure(
          "Check the version",
          `installed version ${version ?? "(unreadable)"} is below the required ${plan.versionCheck.minVersion}`,
        );
      }
    }

    if (movedPrevious) await ports.fs.remove(previous).catch(() => undefined);
    return { status: "installed", dir: plan.dir, ...(version ? { version } : {}) };
  } catch (error) {
    const failure = error instanceof StepFailure ? error : new StepFailure("Install", String(error));
    let stranded = "";
    if (createdDir) {
      await ports.fs.remove(plan.dir).catch(() => {
        stranded = ` ${plan.dir} could not be cleaned up.`;
      });
    }
    if (movedPrevious) {
      await ports.fs.rename(previous, plan.dir).catch((e: unknown) => {
        stranded += ` The previous install could not be restored (${String(e)}): it is stranded at ${previous}; move it back to ${plan.dir}.`;
      });
    }
    return { status: "failed", step: failure.step, message: failure.message + stranded };
  } finally {
    await ports.fs.remove(plan.downloadDir).catch(() => undefined);
  }
}

export type MachineToolUninstallResult = { status: "uninstalled"; dir: string } | { status: "refused" };

/** Removes the tool's directory (the venv lives inside it) after consent. */
export async function uninstallMachineTool(
  plan: MachineToolInstallPlan,
  consent: MachineToolConsent,
  ports: MachineToolPorts,
): Promise<MachineToolUninstallResult> {
  if (!(await consent.confirm(plan))) return { status: "refused" };
  await ports.fs.remove(plan.dir);
  return { status: "uninstalled", dir: plan.dir };
}
