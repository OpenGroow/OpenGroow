# Developing a Template

A Template is a Claw package: `package.json`, `CLAW.md`, `workspace/`, `profiles/opengroow.yml` and optionally `plugins/`. Published Templates are installed from the hub catalogue (Add Agent). To work on a Template that is not published, install it from a local folder, on a self-hosted or development deployment.

## Iterating on a Template

Edit the package folder (in a hub repository checkout) and run `pnpm template:link <folder> --project <projectId>`: each save becomes the Template's current snapshot, and a running Agent receives it with the dashboard **Refresh**. There is no codegen, no embedded copy and no restart of Convex: no Template content is compiled into OpenGroow (#674, ADR-058). `pnpm template:validate <folder>` checks a package with the reader used at installation. Hub repositories run the same check in CI with `npx @opengroow/template-validator@<version> package <folder>`: `packages/template-validator` is a bundle of that reader, built from this repository and published to npm by the **Publish Template Validator** workflow. There is no copy of the reader: when the manifest format changes (a new field, a new rule), bump `version` in `packages/template-validator/package.json`, merge, push the tag `template-validator@<version>`, then bump the version pinned in the hub's `validate.yml`. Tag only from `main`: the bundle is built from the tagged commit.

## Install from a local folder

| Way | When to use it |
| --- | --- |
| Dashboard: Project, Agents, Add Agent, **Add from a local folder** | One-off install from the UI. Self-host only: the option is absent on the hosted deployment. |
| `pnpm template:add <folder> --project <projectId>` | Same install from a terminal (#652). |
| `pnpm template:link <folder> --project <projectId>` | Live sync: each save of the folder becomes the Template's current snapshot (#653). Terminal only. |
| `pnpm template:add-git` | Install from a Git release archive (#667). |

`<projectId>` is the Project's Instance id (`openclawId`).

### Add from a local folder (dashboard)

1. Click **Add from a local folder** in the Add Agent dialog and pick the package folder (the one containing `CLAW.md`).
2. The browser reads the folder (the dashboard server never needs to see your disk, so it works in the full Docker stack) and the server returns the installation plan: MCP hosts, secrets, skills, machine prerequisites. An invalid package is refused here with its message, before anything is stored.
3. **Install and activate** stores the package with origin `local_folder`, reconciles the Instance and activates the Agent.

Limits, applied before anything is sent: text files only (UTF-8), 512 KiB per file, 500 files, 8 MiB in total; `.git`, `node_modules` and `.DS_Store` are skipped. The same conversion lives in `packages/agent-templates/src/folder-files.ts`.

The server enforces the self-host restriction: `previewLocalFolder` and `installLocalFolder` (`project_templates_node.ts`) and the public `project_templates.install` mutation refuse when `IS_SELF_HOST` is not set. On the hosted deployment the hub is the only way to install a Template.

### Updating

A Template installed from a folder has no upstream. Pick the folder again with a new `version` in `package.json` (it is offered as an update, #669) or use `template:link` for live sync. Existing Missions stay pinned to the version they were created with (#651).

## Installable machine tools (#726)

A `machinePrerequisites` entry describes a **Tool** (see `GLOSSARY.md`): a program on the user's machine, distributed as an npm package. Declare `installCommand` (exactly `npm install -g <package>[@version]`, validated strictly) and `externalPrerequisites` (`[{ name, instructionsUrl }]`, e.g. Python, `adb`). The installation plan shows them with a copy button; OpenGroow never runs the command and shows no installed state.

A `machinePrerequisites` entry can also declare `install` so the tool is installed on the user's own machine (the paired node) after explicit consent, instead of linking to instructions. Shape, in the profile's `machinePrerequisites`:

```yaml
- name: Android CLI
  minVersion: "0.1.0"
  instructionsUrl: https://example.com/doc
  install:
    id: android                       # slug; installs in ~/.opengroow/tools/android
    source: { url: https://example.com/android-0.1.0.tgz, sha256: <64 lowercase hex> }
    requires:                         # what cannot be auto-installed
      - { name: ADB, check: [adb, version], instructionsUrl: https://example.com/doc }
    bootstrap:                        # argv arrays, no shell; {dir} = install directory
      - { label: Create the venv, run: [python3, -m, venv, "{dir}/engine/.venv"] }
      - { label: Install dependencies, run: ["{dir}/engine/.venv/bin/pip", install, -r, "{dir}/engine/requirements.txt"] }
    versionCheck: { run: ["{dir}/bin/opengroow-android", --version] }   # required with minVersion
```

Try it on a machine with `pnpm template:machine-tool <package folder> [--tool <id>] [--uninstall]`. It prints the source, sha256 and exact commands, asks `[y/N]`, and leaves the machine unchanged on refusal or failure. Design: ADR-067.

## Migrating a Template to Publishable (ADR-069)

By default a Template publishes through its own MCP. A Mission type can instead hand publication to the Project's **Publisher** (see `docs/domain/publishing.md`). Migration is an opt-in, per Mission type, with three steps.

### 1. Declare `publish` in the manifest

On the Mission type's entry in `missionTypes[]`:

```json
"publish": { "kind": "carousel", "targets": ["instagram", "pinterest:recipes"] }
```

- `kind` is one of the closed set below. A new kind is a product change in OpenGroow, never a Template declaration.
- `targets` is a non-empty, duplicate-free list of logical **Publish targets**: lowercase letters, digits, `-` or `_`, with an optional `:qualifier` (for example `instagram`, `pinterest:recipes`). Never a service channel id, board id or account: the Publisher maps targets to real channels.
- No other key is allowed. `validateManifest` (`packages/agent-templates/src/publish-declaration.ts`) checks all of this at Activation and `pnpm template:validate` reports it with the manifest path.

### 2. Return a `publishable`

The Agent sets `artifact.publishable` in its RunResult. OpenGroow appends a `## Publishable` section with the JSON Schema of the declared kind to the Mission's `context.md`, so the instructions need not restate it. An invalid or missing `publishable` is rejected with per-field errors and the Agent retries. It carries **references only** (URLs), never content (ADR-010).

The three V1 kinds (source of truth: `apps/convex/publishable.ts`). All are strict objects (unknown fields are rejected); every kind also accepts an optional free `metadata` object.

| `kind` | Required fields | Optional fields |
| --- | --- | --- |
| `video` | `videoUrl`, `caption` | `coverUrl`, `title` (max 500), `metadata` |
| `image` | `imageUrl`, `caption` | `metadata` |
| `carousel` | `slideUrls` (1 to 20 URLs, in slide order), `caption` | `metadata` |

URLs are valid URLs of at most 2048 characters; `caption` is at most 5000 characters. Per-target settings (for example TikTok privacy) come from the Publisher configuration, never from the Publishable: `metadata` and `coverUrl` are not forwarded to Postiz today.

### 3. Remove publishing from the MCP and the instructions

A Mission type that declares `publish` **must not publish itself**:

- **The Agent never publishes.** Remove every call to a publishing tool from its `AGENTS.md` file and tell it to return the `publishable` instead. Publication happens on the human `publish` action of the review, or automatically with `autoPublish`, executed by the Publisher.
- **No dual-write.** Remove the publishing settings from the MCP too (Postiz channel, board id, credentials, `pinterestBoardId`-style parameters) and from its dashboard and `statusCheck`. The Template must not both publish through the MCP and declare `publish`, or the deliverable would be posted twice.
- The target is not chosen by the Agent: it comes from `payload.publishTarget` (or `payload.publishTargets` for several), defaulting to the first declared target, and the human can change it in the review. Remove target or board parameters from Mission and Schedule payload instructions accordingly.
- Keep the review's `publish` capability for the Mission type; the generic engine routes it to the Publisher instead of an MCP effect.

Mission types that do not declare `publish` behave exactly as before. `article` publishing (GitHub, `seo`) is out of V1 and stays in its MCP.
