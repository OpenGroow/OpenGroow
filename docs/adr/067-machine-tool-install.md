# ADR-067: Machine tools are installed on the paired machine, after consent, from a verified artifact

**Status:** Accepted for the first implementation (#726). The dispatch from the dashboard to the node is an open decision (see below).

## Context

`machinePrerequisites` (#662) only displayed a name, a minimum version and a link. Some Agents need a tool on the user's own computer (the Android CLI: a Python engine in a virtual environment with `uiautomator2`, plus ADB). Installing it means running code on that machine, so it needs consent, a trusted artifact and a clean failure.

## Decision

- **Manifest.** `machinePrerequisites[].install` (optional, strictly validated, unknown keys refused): `id` (slug, names the directory), `source` (`https` `.tgz` URL from a hub `tools/` release + lowercase `sha256`), `requires` (programs it cannot install itself, each with an argv check and an instructions link, e.g. ADB), `bootstrap` (ordered steps), `versionCheck` (argv + optional regex; mandatory when `minVersion` is set). Commands are **argv arrays, never shell strings**; the only placeholder is `{dir}`. Without `install`, the prerequisite stays display only.
- **Where it runs.** The installer (`machine-tool-install.ts`) acts only through injected ports. The real ports (`machine-tool-node-ports.ts`) belong to the Node process on the user's machine, i.e. the paired node. Nothing is installed in the Instance's container, and Convex never executes a tool command.
- **Consent.** The plan is built from the manifest and is the single source of what runs: `describeMachineToolPlan` prints the source, the sha256, the directory and every command exactly as executed. No download or write happens before an explicit yes. A prerequisite check (read-only) runs after the yes, before the download.
- **Verified download.** The artifact's sha256 is compared before anything is written or extracted; a mismatch fails with nothing installed.
- **Failure leaves the machine unchanged.** The tool is installed in its final directory (`~/.opengroow/tools/<id>`; a venv bakes absolute paths in, so staging then renaming would break it). An existing install is renamed to `<dir>.previous` and restored on any failure; the download directory is always removed. A missing prerequisite, a failed step or a version below `minVersion` reports the step and the output tail.
- **Update.** Same flow on a new release (new `source`): the old install is kept until the new one passes its version check. Updating is a new consent, never silent.
- **Uninstall.** After consent, the tool directory is removed (the venv lives inside it). Programs listed in `requires` are never touched.
- **Entry point today.** `pnpm template:machine-tool <package folder> [--tool <id>] [--uninstall]`, run on the machine, prompts `[y/N]`.

## Open decision (flagged, not blocking)

How the dashboard triggers this on the paired node. The proposed minimal design is a Convex command `machine_tool.install` with the plan, dispatched to the node, which shows the same consent text in its own approval prompt (OpenClaw's exec approval) and replies with the `MachineToolInstallResult`; the dashboard only shows status. Until the product has a node-side command channel, the CLI above is the supported path, and the installation plan flags installable prerequisites (`installFrom`) so the dashboard can point to it.

## Not verified

The end to end install of the real Android CLI on a clean machine: its release does not exist yet (#720). The flow is covered with in-memory ports and a fixture shaped like the Android CLI.
