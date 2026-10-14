# WhatsApp QR Pairing

## Architecture

WhatsApp pairing is handled by the OpenClaw gateway container via the **control socket server** (`apps/openclaw-docker-config/docker/control-socket-server.js`, which routes `/whatsapp/pair/*` to `control-socket-whatsapp-workflow.js`; the QR parsing lives in `control-socket-whatsapp-qr.js`). The runtime worker forwards the dashboard commands (`apps/openclaw-runtime-worker/src/commands/whatsapp-commands.ts`).

The dashboard calls two HTTP endpoints on the Unix socket, `/whatsapp/pair/start` and `/whatsapp/pair/wait`, which orchestrate the WhatsApp Web login and return a QR code as `data:image/svg+xml` to display in the UI.

```
Dashboard UI
  └─ POST /whatsapp/pair/start   (control socket HTTP over Unix socket)
       └─ spawn: openclaw channels login --channel whatsapp
            └─ stdout: ANSI QR art → parsed → data:image/svg+xml
  └─ POST /whatsapp/pair/wait
       └─ openclaw channels status --probe --json
```

## Version dependencies

The WhatsApp plugin has been a separate npm package since OpenClaw `2026.5.19`. The plugin version **must be aligned** with the OpenClaw version installed in the image.

The image does **not** ship the plugin (issues #638, #639, ADR-068): an Instance installs it at start, only when `whatsapp` is listed in `OPENCLAW_OPTIONAL_PLUGINS` (see "Optional plugins" in `docs/ARCHITECTURE.md`). The version is the one of the image, read from a single file:

```
apps/openclaw-docker-config/OPENCLAW_VERSION
```

`docker/optional-plugins.js` installs `@openclaw/whatsapp@<that version>` at every start where it is missing. Without `whatsapp` in the variable there is no WhatsApp: the Dashboard shows the card as unavailable and Convex answers the pairing actions with a clear error.

**To update OpenClaw**: change the value in `OPENCLAW_VERSION` then rebuild the image (`pnpm openclaw:local`).

> ⚠️ Never install `@openclaw/whatsapp@latest` separately from the main package — a version mismatch causes `PluginLoadFailureError: Cannot find module plugin-sdk/root-alias.cjs/...`.

## QR code format

Since OpenClaw `2026.5.19`, `openclaw channels login --channel whatsapp` renders the QR as ANSI escape codes:

```
\x1b[40m  \x1b[0m  →  black module
\x1b[47m  \x1b[0m  →  white module
```

The control socket server parses this format with `extractAnsiQrToDataUrl()` and generates an inline SVG (no external dependency):

```
output stdout
  └─ "scan this QR:" (anchor)
  └─ ANSI lines  →  2D 0/1 matrix
  └─ SVG rect per black module  →  data:image/svg+xml;base64,...
```

The old format `![whatsapp-qr](data:image/...)` is kept as a fallback in `extractWhatsAppQrDataUrl()` for builds that still emit it.

## Pairing flow

```
pairStart (control-socket-whatsapp-workflow.js)
  1. If force=true  →  logout() + sleep(3s) + clearAuthState()
  2. If an active session already exists  →  return the ongoing session
  3. Otherwise  →  startSession()
       a. spawn openclaw channels login --channel whatsapp
       b. accumulate stdout/stderr
       c. as soon as extractWhatsAppQrDataUrl() finds the QR  →  startReady.resolve()
       d. if "Linked!" or "credentials saved" is detected (credentials already exist)
          →  startReady.resolve() + scheduleGatewayContainerRestart()
       e. process exit  →  finalize() (probe status)

pairWait
  1. Wait for session.completion or timeout
  2. openclaw channels status --probe --json
  3. If session rejected (device_removed / stream error)  →  clearAuthState()
  4. Return linked/connected, plus the current qrDataUrl while not linked
```

### QR rotation

WhatsApp issues a new QR about every 20 s while the user scans. The control socket keeps the latest one and when it was issued, and **both** `pair.start` and `pair.wait` return:

- `qrDataUrl`: the current QR;
- `qrExpiresInMs`: the time left on it, as a duration rather than a date so that the Instance and browser clocks need not agree (absent when there is no QR).

The Channels page checks every few seconds (`WHATSAPP_PAIR_WAIT_TIMEOUT_MS`), replaces the QR with the one returned, and dims it with "Refreshing the QR code…" once `qrExpiresInMs` has elapsed. The worker (`handleWhatsAppPairWait`), the protocol (`runtime-whatsapp.ts`) and the Convex parser (`parseRuntimeWhatsAppPairPayload`) must all forward both fields: a field dropped at one hop shows up as a stale QR.

## "Linked but not connected" state

If the gateway has WhatsApp credentials but the channel isn't active (e.g. after a restart without `channels add`), the dashboard shows a **"Reconnect WhatsApp"** button. This button triggers a `pair.start` without `force=true`, which:

1. Detects the existing credentials → "Linked!" in stdout
2. Schedules a gateway restart
3. On restart, the WhatsApp channel starts automatically

> ⚠️ For the channel to start automatically on restart, `openclaw channels add --channel whatsapp` must have been run at least once. Without that, the plugin is installed but no channel is configured in `openclaw.json`.

## WhatsApp plugin startup handling (entrypoint)

The entrypoint (`docker/entrypoint.sh`) runs `node /opt/openclaw-control/optional-plugins.js` before the gateway starts. It reconciles the Instance with `OPENCLAW_OPTIONAL_PLUGINS`, reading the real state from `openclaw plugins list --json`:

- `whatsapp` listed and not installed → install `@openclaw/whatsapp` at the image's OpenClaw version, enable it, add it to `plugins.allow` when that list exists;
- `whatsapp` installed but no longer listed → uninstall it. This also erases the `channels.whatsapp` config (the link has to be redone if the plugin comes back);
- already installed, enabled and allowed → nothing to do.

A failure (for example the npm registry is unreachable) is logged as a warning and does not stop the gateway; the next start tries again.

> ⚠️ `openclaw plugins install` says "Restart the gateway to load plugins" even when the gateway hasn't started yet. This message is meant for the case where a gateway is already running — in our flow (install before startup), the plugin is loaded directly without an extra restart.

## Unix socket and VirtioFS (Docker Desktop macOS)

The control socket (`/home/node/.openclaw/runtime/control.sock`) is shared between the two containers via a **named Docker volume** (`openclaw-runtime-sock`). This choice is intentional:

- Bind mounts on Docker Desktop macOS use VirtioFS, which returns `ENOTSUP` on `unlink()` for socket files → the control socket server crashes on startup if a stale socket exists
- A named Docker volume doesn't have this limitation

**Do not go back to a bind mount for this directory.**

The control socket server's shutdown handler removes the socket file cleanly on SIGTERM (`fs.unlinkSync(SOCKET_PATH)` in the `server.close()` callback).

## AI providers

The list of supported providers is in `PROVIDER_ENV_KEYS` (`control-socket-channel-workflow.js`). To add a provider:

1. Add the entry in `PROVIDER_ENV_KEYS` (e.g. `xiaomi: "XIAOMI_API_KEY"`)
2. If the provider uses the OpenAI-compatible API, it doesn't need `auth.profiles` — only Anthropic and OpenAI do (`needsAuthProfile` in the same file)
3. Update `defaultBaseUrlForProvider` and `labelForProvider` in `apps/dashboard/src/components/instance-workspace.utils.ts`
4. Add the `<SelectItem>` in `apps/dashboard/src/components/providers-page-content.tsx`

Non-standard providers (e.g. Xiaomi) use `models.providers.${provider}` with `api: "openai-completions"` instead of Anthropic/OpenAI's `auth.profiles` system.

## Troubleshooting

| Error | Cause | Fix |
|--------|-------|-----|
| `Plugin "@openclaw/whatsapp" requires plugin API >=X` | OpenClaw version too old | Bump `OPENCLAW_VERSION`, rebuild |
| `plugin already exists: ... (delete it first)` | Stale plugin from an older version | The install uses `--force`, so the next start replaces it |
| WhatsApp card says "Not available on this Instance" | `whatsapp` is not in `OPENCLAW_OPTIONAL_PLUGINS` | Add it to `.env`, restart `pnpm dev` (Convex keeps its copy), then restart the Instance |
| `PluginLoadFailureError: Cannot find module plugin-sdk/root-alias.cjs/...` | `@openclaw/whatsapp` version ≠ OpenClaw version | Check `OPENCLAW_VERSION`, rebuild the image |
| `openclaw channels login exited before QR was generated (exit code 0): Linked!` | Credentials already present, not an error | Normal — our code detects "Linked!" and schedules a restart |
| `invalid channels.start channel` | WhatsApp channel not configured in `openclaw.json` | Run `openclaw channels add --channel whatsapp` in the container |
| `ENOTSUP: operation not supported on socket, unlink` | Stale socket on VirtioFS bind mount | The named volume `openclaw-runtime-sock` prevents this — do not remove it |
| `touch: cannot touch '...bootstrap-complete': Permission denied` | Named volume mounted on `runtime/` with root permissions | Remove the volume (`docker volume rm`) and rebuild to recreate it with the right permissions |
| `Timed out waiting for WhatsApp QR code` | QR format not recognized in stdout | Check that stdout contains `"scan this QR:"` followed by `\x1b[40m` sequences |
| `WhatsApp rejected the saved session` | Invalid credentials (device_removed, stream error) | The code automatically cleans up `~/.openclaw/credentials/whatsapp/default` and requests a new QR |
| `400 Not supported model <name>` | Incorrect model name for this provider | Check the exact model name in the provider's docs |
