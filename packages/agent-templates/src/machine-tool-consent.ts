/**
 * The text a user reads before consenting to a machine tool install (#726):
 * source, digest, directory, and every command exactly as it will run.
 */
import type { MachineToolInstallPlan } from "./machine-tool-install";

const quote = (arg: string) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`);
const shown = (argv: string[]) => argv.map(quote).join(" ");

export function describeMachineToolPlan(plan: MachineToolInstallPlan): string {
  const lines = [
    `Install "${plan.name}" on this computer`,
    "",
    `Source:    ${plan.source.url}`,
    `sha256:    ${plan.source.sha256} (the download is refused if it differs)`,
    `Directory: ${quote(plan.dir)}`,
  ];
  lines.push("", "Before extracting, the archive's entries are listed and refused if any is an absolute path, contains .., or is a link:", `  $ ${shown(plan.archiveChecks.names)}`, `  $ ${shown(plan.archiveChecks.types)}`);
  if (plan.requires.length > 0) {
    lines.push("", "Checked first (read-only):", ...plan.requires.map((r) => `  $ ${shown(r.command)}    # ${r.name}`));
  }
  lines.push("", "Commands that will run, in order:", ...plan.steps.map((s) => `  $ ${shown(s.run)}    # ${s.label}`));
  if (plan.versionCheck) {
    lines.push(
      "",
      `Then checked${plan.versionCheck.minVersion ? ` (minimum version ${plan.versionCheck.minVersion})` : ""}:`,
      `  $ ${shown(plan.versionCheck.run)}`,
    );
  }
  lines.push("", "If anything fails or you refuse, this computer is left unchanged.");
  return lines.join("\n");
}

/** What `--uninstall` does: no command runs, one directory is deleted. */
export function describeMachineToolUninstall(plan: MachineToolInstallPlan): string {
  return [
    `Remove "${plan.name}" from this computer`,
    "",
    `Directory: ${quote(plan.dir)}`,
    "",
    `This directory and everything inside it will be deleted, recursively (including any virtual environment it holds). Nothing else is touched and no command runs.`,
  ].join("\n");
}
