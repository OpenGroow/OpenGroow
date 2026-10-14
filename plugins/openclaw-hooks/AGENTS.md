# @opengroow/openclaw-hooks

General hooks toolkit for native OpenClaw plugins that run in-process inside the
Gateway/runtime-worker, using `openclaw/plugin-sdk/plugin-entry`'s trusted-plugin
`register(api)` API (`api.on(hookName, handler)`, `api.runtime.*`). It is a
library: it is not an OpenClaw plugin itself and nothing in the product installs
it. An agent's own plugin, shipped inside its package, imports it and adds the
agent-specific hooks.

The Android CLI the agents drive (`opengroow-android`) is a machine-side tool
maintained outside this repository (private-groowhub, `tools/android`). Hooks
never read its files: they only recognize the command lines the agent sends
through `exec` on the paired node.

The `openclaw` devDependency must stay pinned to the same version as
`apps/openclaw-docker-config/OPENCLAW_VERSION`: the image symlinks that
globally-installed copy in as the plugin's `openclaw`, so a drift means the
types checked here are not the SDK loaded at runtime. The plugin-sdk export
map is not stable across versions (the `openclaw/plugin-sdk` barrel was
dropped in 2026.8.1), so a bump can break imports.

## Package structure

- `src/index.ts` — the public surface, consumed as `@opengroow/openclaw-hooks`.
- `src/command-match.ts` — `isNodeHostExecCall`: is this event a node-host exec
  (`node_exec`, or `exec` with `host: "node"`), whatever the harness.
- `src/gateway-path-guard.ts` — `before_tool_call` guard: blocks a node-host exec
  whose `workdir` is a gateway workspace path, which does not exist on the Mac,
  and tells the agent to use `read`/`write`. An agent plugin passes a
  `NodeCommandPolicy` to restrict which node commands that agent may run.
- `src/node-run.ts` — the `system.run` call shape: argv array (never a shell
  string — the node host coerces a string to an empty argv and silently runs
  nothing), `{ ok, payload | payloadJSON }` envelope unwrapping, non-zero exit
  becomes a throw.
- `src/plugin-runtime-deps.ts` — `PluginRuntimeDeps` (read/write/delete on the
  node and the workspace) wired onto a real `OpenClawPluginApi.runtime` plus the
  local filesystem; hooks take it as a parameter so tests never touch the runtime.

## What lives in the agent's package instead

The agent-specific hooks (report sync, per-agent credential delivery, the command
allowlist) and the plugin entry that wires them are not here: they live in the
agent's own package, outside this repository (the Template hub), which depends
on this library. Nothing in this repository builds or bundles an agent plugin:
the generic test package `fixtures/packages/engagement` only ships a hand-written
no-op plugin so the engine tests can exercise the packaged-plugin install.

## Discovery requirements (for the agent's plugin)

A directory under `<config dir>/extensions/` is only picked up when its
`package.json` declares `openclaw.extensions` (the fallback is a bare
`index.js` at the package root, which a `dist/` build does not have). The
plugin id used by `plugins.allow` comes from `openclaw.plugin.json`'s `id`.

## Build & test

```bash
pnpm --filter @opengroow/openclaw-hooks typecheck
pnpm vitest run plugins/openclaw-hooks
```

## Deploying a change

The plugin is **not** baked into the OpenClaw image (#661). It ships inside the
agent's Template package (`plugins/<id>/` of the package folder, published in
the Template hub repository), and OpenGroow installs it into the Instance when
the Agent is activated, refreshed or reconciled. Bundling the plugin against
this library is done in the hub repository. A changed or new plugin needs a
Gateway restart: OpenClaw reads plugin code at Gateway start only. OpenGroow
restarts the Gateway once, last, and only when the files differ from what is
installed (an identical reinstall is a no-op).
