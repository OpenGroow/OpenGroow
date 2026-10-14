# ADR-055: Template OpenClaw plugins ship inside the package and are installed into the Instance by reconciliation

**Status:** Accepted

### Context

ADR-054 says Template-specific code lives in MCP servers or in OpenClaw plugins installed in the Instance, but the only plugin (Social Engagement's report-sync) was still copied into the OpenClaw image and re-copied at every boot, so changing it needed an image rebuild and redeploy. Does installing a plugin need a Gateway restart? OpenClaw's documentation says yes: installing, updating or uninstalling plugin code requires a Gateway restart (a managed Gateway with config reload restarts by itself; plugin metadata is read once at startup).

### Decision

1. A package carries its plugins as `plugins/<id>/` folders (a complete OpenClaw plugin: `package.json` with `openclaw.extensions`, `openclaw.plugin.json` whose id equals the folder name, the built entry). The Claw adapter validates and collects them into `AgentTemplate.plugins` (not a manifest key); a plugin is bounded to 512 KiB.
2. Reconciliation (activation, refresh, reconcile after `template:add` or reprovisioning) sends the plugins to the Instance with a `runtime.plugins.install` command. The control socket next to the Gateway writes them into `<config dir>/extensions/<id>/` (staged, then renamed), links `node_modules/openclaw` to the global package, adds the id to `plugins.allow` when the allowlist exists, and answers per plugin whether it changed (SHA-256 of its files). Convex still never executes package code.
3. Only a changed or new plugin restarts the Gateway (`openclaw gateway restart`, the container restart already used for WhatsApp). Convex does it once, as the last runtime call of the activation/refresh, or after every Agent of a reconciliation, because the Instance is unreachable while it restarts. A failed restart is logged, not fatal: the plugin loads on the next Gateway start.
4. The plugin leaves the image (no `COPY`, no entrypoint step). The built-in Social Engagement Template embeds it through the codegen, from `templates/social-engagement/plugins/`.

### Considered options

- **`openclaw plugins install <path>` through the exec route**: rejected, a local install does not provide `openclaw/plugin-sdk` to the plugin, and it would widen the allowed `openclaw` command roots.
- **Publishing the plugin to npm or ClawHub and declaring `{kind: "plugin"}` in `CLAW.md`**: rejected for now, it adds a release channel and a network dependency for a private plugin; a registry source can be added later beside folder plugins.
- **Restarting the Gateway on every reconciliation**: rejected, it would interrupt runs for no change.

### Consequences

- Changing the plugin needs a Template update, not an image rebuild; a reprovisioned Instance gets it back through reconciliation.
- A plugin the Template stops declaring is not uninstalled (out of scope).
- Instances whose runtime worker predates the command report an explicit error asking to update the runtime.
