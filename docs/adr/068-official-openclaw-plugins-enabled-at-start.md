# ADR-068: Official OpenClaw Plugins are enabled by the operator at start, and the environment variable is the source of truth

**Status:** Accepted (#638, #639).

## Context

The gateway image shipped Codex, WhatsApp, Xiaomi and Groq: 377 MB per Instance, 290 MB of it for Codex alone. Nobody is required to have WhatsApp or Codex, and the base image has to be empty of optional plugins to be packaged. Yet these plugins carry product features: the WhatsApp channel and its pairing, the ChatGPT subscription, the Xiaomi provider, Groq speech-to-text.

## Decision

- **One list per deployment.** `OPENCLAW_OPTIONAL_PLUGINS` holds comma-separated ids (`codex`, `whatsapp`, `xiaomi`, `groq`). It is empty by default and the image ships none of them. In the cloud the same variable is repeated on every Instance with every option.
- **Reconciled at every start, before the Gateway runs**, so no Gateway restart is ever needed. Listed plugins are installed (pinned to the OpenClaw version), enabled and added to `plugins.allow`. Installed optional plugins that are not listed are uninstalled.
- **The state is read from `openclaw plugins list --json`**, not from a file of ours: it stays right after an interrupted start, a recreated container or a plugin added by hand.
- **`plugins.allow` is only edited when it exists, and never emptied.** It is an exclusive allowlist: an absent list allows everything, an empty one blocks everything.
- **Three readers of the same variable.** The Instance (installs), the Dashboard (hides the features of unlisted plugins) and Convex (the WhatsApp watchdog has no candidates, and the WhatsApp actions answer with an error, when `whatsapp` is not listed: a missing plugin is not a failed link).
- Domain term: **Official OpenClaw Plugin**, distinct from a Template's Plugin (`docs/domain/runtime.md`).

## Considered options

- **Install on demand from the dashboard.** Needs a Gateway restart that cuts running agents, a 290 MB download inside the auth workflow's timeout, a visible "installing" status, and a watchdog that tolerates it. Rejected: the operator already knows at deploy time which features an Instance offers.
- **Keep the plugins in the image behind a build argument.** One image per combination, and a heavier image for everyone who enables one. Rejected.
- **Disable without uninstalling.** Reversible without a new pairing, but frees no disk. Rejected for uninstalling, which matches "the variable is the truth".
- **Convex as the source of truth**, each Instance reporting what it really has. More exact with different lists per Instance, but a new Instance-to-Convex flow across five packages. Not needed while a deployment has one list.

## Consequences

- **Removing a plugin from the list uninstalls it and erases its configuration.** For WhatsApp, that is the paired channel: the user scans a QR code again. A `.env` that fails to load is enough to trigger it.
- **An existing Instance loses its plugins** if the variable is not set before its next recreate (`rollout`).
- **Three copies, not one value.** The Instance, the Dashboard and Convex each read their own copy of the variable, and none of them checks what the Instance really has. If an install fails (npm unreachable, no disk), the Instance logs a warning and starts anyway, and the Dashboard still offers the feature. Convex keeps its copy in its own variable store: `pnpm dev` and the Docker bootstrap push it on every run, so editing `.env` without restarting leaves Convex on the old list.
- This is coherent while a deployment has one list (local, or the cloud with every option). Different lists per Instance would need the Instance to report its real plugins.
- A ChatGPT login without the `codex` plugin still only logs a warning on the Instance; only the Dashboard hides it.

## Verified on a real image (2026-10-13)

Image built from this branch (OpenClaw 2026.9.1), throwaway containers on a fresh home, entrypoint path:

- `codex,whatsapp,xiaomi,groq` installs all four: each is `enabled`, `loaded`, and added to `plugins.allow` (378 MB under `~/.openclaw/npm`).
- Restarting an existing home with a longer list installs only the new plugin. The same list again changes nothing.
- Restarting with a shorter list uninstalls the ones that left (`xiaomi`, then `groq`), removes them from `plugins.allow` and frees the disk (378 to 291 MB after WhatsApp and Xiaomi left, 0 once the variable was empty). `plugins.allow` was never emptied.
- Uninstalling WhatsApp erases `channels.whatsapp` (checked with a configured channel).
- An unreachable npm registry logs one readable warning, leaves the plugin absent and exits 0, so the Gateway still starts.
- The ChatGPT OAuth login with the `codex` plugin on a real Instance: it completes, activates `codex`, sets `agents.defaults.model.primary`, and the linked profile is visible from every agent (shared store, read-through).
- A real model call with the linked ChatGPT subscription: `openclaw agent --agent main` answers "OK" with `provider: openai`, `model: gpt-5.5`, `agentHarnessId: codex` (the plugin), `credentialSource: profile`, in 5.7 s.
- A WhatsApp pairing on a real Instance: the QR is generated by the installed plugin, scanned, and accepted (once the QR refresh was fixed: see #639).

## Not verified

- `openclaw plugins install` run through `docker exec` fails on this setup with "Plugin artifact has no valid plugin manifest", while the same command succeeds from the entrypoint and under `docker run` (same script, same image). The cause is not explained, so do not install a plugin by hand with `docker exec`: change the variable and restart. Tracked in #744.
- The WhatsApp link watchdog (#493) can disable the channel while a pairing is in progress, which then restarts the Gateway. It is not caused by this decision, but the pairing flow it breaks is the one this decision gates. Tracked in #743.
- Neither the Dashboard nor Convex checks the real state of a plugin: they read the variable, so an install that failed at start (registry unreachable, disk full) still shows the feature as available. Only the Instance log says so.
- A deployment without access to the npm registry cannot install any of these plugins: the image carries none and there is no build argument to pre-install them (asked for in #638).
- In the cloud, the variable has to be set by whoever provisions the Instances; nothing in this repository does it.
