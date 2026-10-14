import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ANDROID_TOOL_FIXTURE } from "./__fixtures__/machine-tool.js";
import {
  planMachineToolInstall,
  installMachineTool,
  uninstallMachineTool,
  type MachineToolPorts,
  type RunResult,
} from "./machine-tool-install.js";
import type { MachinePrerequisite } from "./types.js";

const ARCHIVE = new TextEncoder().encode("pretend this is android-0.1.0.tgz");
const ARCHIVE_SHA = createHash("sha256").update(ARCHIVE).digest("hex");
const ROOT = "/home/u/.opengroow/tools";
const DIR = `${ROOT}/android`;

const prerequisite = (overrides: Partial<MachinePrerequisite["install"] & object> = {}): MachinePrerequisite =>
  ({
    ...ANDROID_TOOL_FIXTURE,
    install: { ...ANDROID_TOOL_FIXTURE.install, source: { ...ANDROID_TOOL_FIXTURE.install.source, sha256: ARCHIVE_SHA }, ...overrides },
  }) as MachinePrerequisite;

/** An in-memory machine: a set of existing paths, a log of everything done, scripted command results. */
function fakeMachine(opts: { paths?: string[]; results?: (argv: string[]) => RunResult | undefined; archive?: Uint8Array; tarListing?: { names: string; types: string }; renameFails?: (from: string) => boolean } = {}) {
  const paths = new Set(opts.paths ?? []);
  const log: string[] = [];
  const ports: MachineToolPorts = {
    toolsRoot: ROOT,
    async download(url) {
      log.push(`download ${url}`);
      return opts.archive ?? ARCHIVE;
    },
    fs: {
      async exists(p) {
        return paths.has(p);
      },
      async mkdir(p) {
        log.push(`mkdir ${p}`);
        paths.add(p);
      },
      async write(p) {
        log.push(`write ${p}`);
        paths.add(p);
      },
      async rename(from, to) {
        if (opts.renameFails?.(from)) throw new Error("EBUSY");
        log.push(`rename ${from} -> ${to}`);
        paths.delete(from);
        paths.add(to);
      },
      async remove(p) {
        log.push(`remove ${p}`);
        for (const existing of [...paths]) if (existing === p || existing.startsWith(`${p}/`)) paths.delete(existing);
      },
    },
    async run(argv) {
      log.push(`run ${argv.join(" ")}`);
      const scripted = opts.results?.(argv);
      if (scripted) return scripted;
      if (opts.tarListing && argv[0] === "tar" && argv[1] === "-tzf") return { code: 0, output: opts.tarListing.names };
      if (opts.tarListing && argv[0] === "tar" && argv[1] === "-tvzf") return { code: 0, output: opts.tarListing.types };
      if (argv[0] === "tar" && argv[1] === "-xzf") paths.add(DIR);
      if (argv.at(-1) === "--version" && argv[0] === `${DIR}/bin/opengroow-android`) return { code: 0, output: "opengroow-android 0.1.3\n" };
      return { code: 0, output: "" };
    },
  };
  return { ports, log, paths };
}

describe("planMachineToolInstall", () => {
  it("shows the source and the exact commands that will run, with the real directory", () => {
    const plan = planMachineToolInstall(prerequisite(), ROOT);
    expect(plan).toMatchObject({
      name: "Android CLI",
      dir: DIR,
      source: { url: ANDROID_TOOL_FIXTURE.install.source.url, sha256: ARCHIVE_SHA },
    });
    expect(plan.requires.map((r) => r.command)).toEqual([["python3", "--version"], ["adb", "version"]]);
    expect(plan.steps.map((s) => s.run)).toEqual([
      ["tar", "-xzf", `${ROOT}/.android.download/archive.tgz`, "-C", DIR],
      ["python3", "-m", "venv", `${DIR}/engine/.venv`],
      [`${DIR}/engine/.venv/bin/pip`, "install", "-r", `${DIR}/engine/requirements.txt`],
    ]);
  });

  it("returns undefined for a prerequisite with no install declaration", () => {
    const { install: _install, ...linkOnly } = ANDROID_TOOL_FIXTURE;
    expect(planMachineToolInstall(linkOnly, ROOT)).toBeUndefined();
  });
});

describe("installMachineTool", () => {
  it("runs exactly the commands it showed, in order, and reports the installed version", async () => {
    const machine = fakeMachine();
    const plan = planMachineToolInstall(prerequisite(), ROOT)!;
    const result = await installMachineTool(plan, { confirm: async () => true }, machine.ports);
    expect(result).toEqual({ status: "installed", dir: DIR, version: "0.1.3" });
    const ran = machine.log.filter((l) => l.startsWith("run ")).map((l) => l.slice(4));
    expect(ran).toEqual([
      ...plan.requires.map((r) => r.command.join(" ")),
      plan.archiveChecks.names.join(" "),
      plan.archiveChecks.types.join(" "),
      ...plan.steps.map((s) => s.run.join(" ")),
      `${DIR}/bin/opengroow-android --version`,
    ]);
    expect(machine.paths.has(`${ROOT}/.android.download`)).toBe(false);
  });

  it("changes nothing when the user refuses", async () => {
    const machine = fakeMachine();
    const plan = planMachineToolInstall(prerequisite(), ROOT)!;
    const result = await installMachineTool(plan, { confirm: async () => false }, machine.ports);
    expect(result).toEqual({ status: "refused" });
    expect(machine.log).toEqual([]);
  });

  it("names the missing prerequisites with their instructions and downloads nothing", async () => {
    const machine = fakeMachine({ results: (argv) => (argv[0] === "adb" ? { code: 127, output: "not found" } : undefined) });
    const plan = planMachineToolInstall(prerequisite(), ROOT)!;
    const result = await installMachineTool(plan, { confirm: async () => true }, machine.ports);
    expect(result).toEqual({
      status: "prerequisite-missing",
      missing: [{ name: "ADB", instructionsUrl: "https://developer.android.com/tools/adb" }],
    });
    expect(machine.log.some((l) => l.startsWith("download"))).toBe(false);
    expect(machine.log.some((l) => l.startsWith("mkdir") || l.startsWith("write"))).toBe(false);
  });

  it("refuses an artifact whose sha256 differs and leaves nothing behind", async () => {
    const machine = fakeMachine({ archive: new TextEncoder().encode("tampered") });
    const plan = planMachineToolInstall(prerequisite(), ROOT)!;
    const result = await installMachineTool(plan, { confirm: async () => true }, machine.ports);
    expect(result).toMatchObject({ status: "failed", step: "Verify the download" });
    expect((result as { message: string }).message).toContain("sha256");
    expect(machine.log.some((l) => l.startsWith("run tar"))).toBe(false);
    expect(machine.paths.has(DIR)).toBe(false);
    expect(machine.paths.has(`${ROOT}/.android.download`)).toBe(false);
  });

  it("does not touch an existing install when the download is rejected", async () => {
    const machine = fakeMachine({ paths: [DIR], archive: new TextEncoder().encode("tampered") });
    const plan = planMachineToolInstall(prerequisite(), ROOT)!;
    await installMachineTool(plan, { confirm: async () => true }, machine.ports);
    expect(machine.paths.has(DIR)).toBe(true);
    expect(machine.log).not.toContain(`remove ${DIR}`);
  });

  it("rolls back when a bootstrap step fails, restoring the previous install", async () => {
    const machine = fakeMachine({
      paths: [DIR],
      results: (argv) => (argv.includes("pip") || argv[0]?.endsWith("/pip") ? { code: 1, output: "No matching distribution" } : undefined),
    });
    const plan = planMachineToolInstall(prerequisite(), ROOT)!;
    const result = await installMachineTool(plan, { confirm: async () => true }, machine.ports);
    expect(result).toMatchObject({ status: "failed", step: "Install the engine dependencies" });
    expect((result as { message: string }).message).toContain("No matching distribution");
    expect(machine.paths.has(DIR)).toBe(true);
    expect(machine.paths.has(`${DIR}.previous`)).toBe(false);
    expect(machine.log).toContain(`rename ${DIR}.previous -> ${DIR}`);
  });

  it("leaves no directory when a first install fails", async () => {
    const machine = fakeMachine({ results: (argv) => (argv[0] === "python3" && argv[1] === "-m" ? { code: 1, output: "boom" } : undefined) });
    const plan = planMachineToolInstall(prerequisite(), ROOT)!;
    await installMachineTool(plan, { confirm: async () => true }, machine.ports);
    expect(machine.paths.has(DIR)).toBe(false);
  });

  it("fails and rolls back when the installed version is below minVersion", async () => {
    const machine = fakeMachine({
      results: (argv) => (argv.at(-1) === "--version" && argv[0] === `${DIR}/bin/opengroow-android` ? { code: 0, output: "0.0.9" } : undefined),
    });
    const plan = planMachineToolInstall(prerequisite(), ROOT)!;
    const result = await installMachineTool(plan, { confirm: async () => true }, machine.ports);
    expect(result).toMatchObject({ status: "failed", step: "Check the version" });
    expect((result as { message: string }).message).toContain("0.0.9");
    expect((result as { message: string }).message).toContain("0.1.0");
    expect(machine.paths.has(DIR)).toBe(false);
  });

  it("compares versions numerically, not as text", async () => {
    const machine = fakeMachine({
      results: (argv) => (argv.at(-1) === "--version" && argv[0] === `${DIR}/bin/opengroow-android` ? { code: 0, output: "v0.10.0" } : undefined),
    });
    const plan = planMachineToolInstall(prerequisite(), ROOT)!;
    expect((await installMachineTool(plan, { confirm: async () => true }, machine.ports)).status).toBe("installed");
  });

  it("keeps the previous install in place until the new one succeeds (update)", async () => {
    const machine = fakeMachine({ paths: [DIR] });
    const plan = planMachineToolInstall(prerequisite(), ROOT)!;
    const result = await installMachineTool(plan, { confirm: async () => true }, machine.ports);
    expect(result.status).toBe("installed");
    const moved = machine.log.indexOf(`rename ${DIR} -> ${DIR}.previous`);
    const tar = machine.log.findIndex((l) => l.startsWith("run tar -xzf"));
    expect(moved).toBeGreaterThan(-1);
    expect(moved).toBeLessThan(tar);
    expect(machine.paths.has(`${DIR}.previous`)).toBe(false);
  });
});

describe("archive safety", () => {
  const install = (tarListing: { names: string; types: string }, paths: string[] = []) => {
    const machine = fakeMachine({ tarListing, paths });
    const plan = planMachineToolInstall(prerequisite(), ROOT)!;
    return installMachineTool(plan, { confirm: async () => true }, machine.ports).then((result) => ({ result, machine }));
  };
  const okTypes = "-rw-r--r-- 0/0 1 2026-01-01 00:00 bin/x\ndrwxr-xr-x 0/0 0 2026-01-01 00:00 bin/\n";

  it.each([["/etc/passwd"], ["../evil"], ["a/../../evil"]])("refuses an archive entry %s before extracting", async (name) => {
    const { result, machine } = await install({ names: `bin/x\n${name}\n`, types: okTypes });
    expect(result).toMatchObject({ status: "failed", step: "Check the archive" });
    expect(machine.log.some((l) => l.startsWith("run tar -xzf"))).toBe(false);
    expect(machine.paths.has(DIR)).toBe(false);
  });

  it("refuses symlinks and hard links", async () => {
    for (const first of ["l", "h"]) {
      const { result, machine } = await install({ names: "bin/x\n", types: `${first}rwxrwxrwx 0/0 0 2026-01-01 00:00 bin/x -> /etc\n` });
      expect(result).toMatchObject({ status: "failed", step: "Check the archive" });
      expect(machine.log.some((l) => l.startsWith("run tar -xzf"))).toBe(false);
    }
  });

  it("does not touch an existing install when the archive is refused", async () => {
    const { machine } = await install({ names: "../evil\n", types: okTypes }, [DIR]);
    expect(machine.paths.has(DIR)).toBe(true);
    expect(machine.log.some((l) => l.startsWith("rename"))).toBe(false);
  });
});

describe("interrupted runs and failing rollbacks", () => {
  const run = (machine: ReturnType<typeof fakeMachine>) =>
    installMachineTool(planMachineToolInstall(prerequisite(), ROOT)!, { confirm: async () => true }, machine.ports);

  it("fails clearly, destroying nothing, when both the install and a stale .previous exist", async () => {
    const machine = fakeMachine({ paths: [DIR, `${DIR}.previous`] });
    const result = await run(machine);
    expect(result).toMatchObject({ status: "failed", step: "Check for an interrupted install" });
    expect((result as { message: string }).message).toContain(`${DIR}.previous`);
    expect(machine.log.some((l) => l.startsWith("remove") && l.includes(".previous"))).toBe(false);
    expect(machine.paths.has(`${DIR}.previous`)).toBe(true);
    expect(machine.paths.has(DIR)).toBe(true);
  });

  it("restores a stranded .previous when the install directory is gone, then installs", async () => {
    const machine = fakeMachine({ paths: [`${DIR}.previous`] });
    const result = await run(machine);
    expect(result.status).toBe("installed");
    expect(machine.log).toContain(`rename ${DIR}.previous -> ${DIR}`);
  });

  it("returns failed, not a rejection, and names the stranded .previous when the rollback cannot rename", async () => {
    const machine = fakeMachine({
      paths: [DIR],
      results: (argv) => (argv[0] === "python3" && argv[1] === "-m" ? { code: 1, output: "boom" } : undefined),
      renameFails: (from) => from === `${DIR}.previous`,
    });
    const result = await run(machine);
    expect(result).toMatchObject({ status: "failed" });
    expect((result as { message: string }).message).toContain(`${DIR}.previous`);
  });

  it("does not undo a good install because the old copy could not be deleted", async () => {
    const machine = fakeMachine({ paths: [DIR] });
    const remove = machine.ports.fs.remove;
    machine.ports.fs.remove = async (p) => {
      if (p === `${DIR}.previous`) throw new Error("EBUSY");
      return remove(p);
    };
    expect((await run(machine)).status).toBe("installed");
  });
});

describe("uninstallMachineTool", () => {
  it("removes the tool directory after consent, and nothing otherwise", async () => {
    const machine = fakeMachine({ paths: [DIR, `${DIR}/engine/.venv`] });
    const plan = planMachineToolInstall(prerequisite(), ROOT)!;
    expect(await uninstallMachineTool(plan, { confirm: async () => false }, machine.ports)).toEqual({ status: "refused" });
    expect(machine.paths.has(DIR)).toBe(true);
    expect(await uninstallMachineTool(plan, { confirm: async () => true }, machine.ports)).toEqual({ status: "uninstalled", dir: DIR });
    expect(machine.paths.has(DIR)).toBe(false);
  });
});
