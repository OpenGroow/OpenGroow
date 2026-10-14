/**
 * `pnpm template:machine-tool <folder> [--tool <id>] [--uninstall] [--root <dir>]`
 *
 * Installs (or removes) a machine-side tool declared by a Template's
 * `machinePrerequisites[].install` on THIS computer, which is the paired node
 * (#726). Nothing runs before the user has read the source, the sha256 and the
 * exact commands and answered `y`. Run it on the machine that hosts the paired
 * node; it never touches the Instance's container.
 */
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { clawPackageToTemplate } from "../src/claw-package.js";
import { describeMachineToolPlan, describeMachineToolUninstall } from "../src/machine-tool-consent.js";
import { installMachineTool, planMachineToolInstall, uninstallMachineTool } from "../src/machine-tool-install.js";
import { DEFAULT_TOOLS_ROOT, nodeMachineToolPorts } from "../src/machine-tool-node-ports.js";
import { readPackageFolder } from "../src/package-folder.js";

const USAGE = "Usage: template:machine-tool <folder> [--tool <id>] [--uninstall] [--root <dir>]";

export type MachineToolArgs = { folder: string; tool?: string; uninstall: boolean; root?: string };

export function parseMachineToolArgs(argv: readonly string[]): MachineToolArgs {
  let folder: string | undefined;
  let tool: string | undefined;
  let root: string | undefined;
  let uninstall = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--tool") tool = argv[++i];
    else if (argv[i] === "--root") root = argv[++i];
    else if (argv[i] === "--uninstall") uninstall = true;
    else folder ??= argv[i];
  }
  if (!folder) throw new Error(`${USAGE}: missing <folder>`);
  return { folder, uninstall, ...(tool ? { tool } : {}), ...(root ? { root } : {}) };
}

async function main(args: MachineToolArgs): Promise<number> {
  const folder = resolve(process.env.INIT_CWD ?? process.cwd(), args.folder);
  const files = Object.fromEntries(readPackageFolder(folder).map((f) => [f.path, f.content]));
  const converted = clawPackageToTemplate(files);
  if (!converted.ok) {
    console.error(`ERROR ${converted.reason}`);
    return 1;
  }
  const ports = nodeMachineToolPorts(args.root ? resolve(args.root) : DEFAULT_TOOLS_ROOT);
  const candidates = (converted.template.manifest.machinePrerequisites ?? []).filter(
    (p) => p.install && (!args.tool || p.install.id === args.tool),
  );
  if (candidates.length !== 1) {
    console.error(
      candidates.length === 0
        ? "ERROR no installable machine tool matches in this package"
        : `ERROR several installable tools; pass --tool <id> (${candidates.map((c) => c.install!.id).join(", ")})`,
    );
    return 1;
  }
  const plan = planMachineToolInstall(candidates[0]!, ports.toolsRoot)!;
  const consent = {
    async confirm() {
      console.log(args.uninstall ? describeMachineToolUninstall(plan) : describeMachineToolPlan(plan));
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question(`\n${args.uninstall ? "Remove" : "Install"}? [y/N] `);
      rl.close();
      return /^y(es)?$/i.test(answer.trim());
    },
  };
  if (args.uninstall) {
    const result = await uninstallMachineTool(plan, consent, ports);
    console.log(result.status === "refused" ? "Refused. Nothing changed." : `Removed ${result.dir}`);
    return 0;
  }
  const result = await installMachineTool(plan, consent, ports);
  switch (result.status) {
    case "installed":
      console.log(`Installed ${plan.name}${result.version ? ` ${result.version}` : ""} in ${result.dir}`);
      return 0;
    case "refused":
      console.log("Refused. Nothing changed.");
      return 0;
    case "prerequisite-missing":
      for (const m of result.missing) console.error(`Missing: ${m.name}. Install it first: ${m.instructionsUrl}`);
      console.error("Nothing was changed on this computer.");
      return 1;
    case "failed":
      console.error(`Failed at "${result.step}": ${result.message}\nThis computer was left unchanged.`);
      return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(parseMachineToolArgs(process.argv.slice(2))).then((code) => process.exit(code));
}
