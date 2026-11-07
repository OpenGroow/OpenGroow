# Developing a Template

A Template is a Claw package: `package.json`, `CLAW.md`, `workspace/`, `profiles/opengroow.yml` and optionally `plugins/`. Published Templates are installed from the hub catalogue (Add Agent). To work on a Template that is not published, install it from a local folder, on a self-hosted or development deployment.

## Iterating on a Template

Edit the package folder (in a hub repository checkout) and run `pnpm template:link <folder> --project <projectId>`: each save becomes the Template's current snapshot, and a running Agent receives it with the dashboard **Refresh**. There is no codegen, no embedded copy and no restart of Convex: no Template content is compiled into OpenGroow (#674, ADR-058). `pnpm template:validate <folder>` checks a package with the reader used at installation. Hub repositories run the same check in CI with `npx @opengroow/groowhub-cli@<version> validate template <folder>`: `packages/groowhub-cli` is a bundle of that reader (and of the Publisher tooling), built from this repository and published to npm by the **Publish groowhub CLI** workflow. There is no copy of the reader: when the manifest format changes (a new field, a new rule), bump `version` in `packages/groowhub-cli/package.json`, merge, push the tag `groowhub-cli@<version>`, then bump the version pinned in the hub's `validate.yml`. Tag only from `main`: the bundle is built from the tagged commit.

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

## Publishing from a Template: the Publishable guide (ADR-069)

By default a Template publishes through its own MCP. A Mission type can instead hand publication to the Project's **Publisher** (see `docs/domain/publishing.md`): the Agent returns a **Publishable**, a small JSON object of references (URLs) and text, and OpenGroow posts it on the channels the human chose. This guide is the whole path for an author writing a Template for their own MCP. Opting in is per Mission type; Mission types without `publish` behave as before.

### Contract at a glance

| Who | Guarantees |
| --- | --- |
| **MCP** | Returns public HTTPS URLs reachable by Postiz. Recommended output names: `videoUrl`, `coverUrl`, `imageUrl`, `slideUrls` (ordered array). Not mandatory. |
| **Manifest** | `publish.kind` (strict), `publish.require` (can only tighten), `publish.resource` (asynchronous MCP only: the tool OpenGroow calls once when the job completes to get the media). |
| **Agent** | Synchronous MCP: returns the whole `artifact.publishable` valid for the kind (copies MCP fields 1:1, or translates another shape). Asynchronous MCP: writes only the text part, in its `in_progress` RunResult, never a media URL. Never publishes. |
| **OpenGroow** | Validates `artifact.publishable` per kind (and `require`), retries the Agent with the error, then publishes through the Publisher. Refuses channels whose platform cannot carry the kind. |

The strict contract is the `publishable`, whoever assembles it. For a synchronous MCP the Agent writes all of it (the MCP naming is a convention that keeps its work trivial, not a lock-in). For an asynchronous MCP (produce, poll, fetch) OpenGroow merges the media returned by `publish.resource.tool` into the Agent's text, then validates the whole. The JSON examples below show the recommended shapes.

### What your MCP must expose

OpenGroow never downloads, stores or transcodes media (ADR-010): it passes **URLs** to the Publisher, and the Publisher (Postiz) fetches them itself. So the MCP must return, for each media:

- a **public HTTPS URL**, reachable from the Postiz server (not `localhost`, not a private network, no cookie or interactive login; a signed URL is fine as long as it stays valid until the post is sent, which can be later when scheduled);
- a URL of at most 2048 characters, serving the file with a correct content type (`video/mp4`, `image/png`, `image/jpeg`...);
- for a carousel, the list of slides **in display order**, as a JSON array.

The MCP does not publish and takes no Postiz, channel or board setting.

### 1. Declare `publish` in the manifest

On the Mission type's entry in `missionTypes[]`:

```json
"publish": {
  "kind": "video",
  "require": ["title", "coverUrl"],
  "resource": { "tool": "get_video" }
}
```

| Key | Required | Meaning |
| --- | --- | --- |
| `kind` | yes | One of `video`, `image`, `carousel` (closed set owned by OpenGroow; a new kind is a product change). |
| `require` | no | Optional fields of that kind your Template **guarantees**. A RunResult without one of them is rejected with a precise per-field error and the Agent retries. It can only tighten the format, never loosen it: required fields cannot be listed, `metadata` cannot be required, duplicates and unknown names are refused. |
| `resource` | no | Asynchronous MCP only: `{ "tool", "idArg"?, "map"? }`. `tool` is an MCP tool of the server that runs the External Job; `idArg` is the argument carrying the job id (default `runId`); `map` is an optional map from a media field (`videoUrl`, `coverUrl`, `imageUrl`, `slideUrls`) to a path in the tool output (dot keys, `[n]`, `[*]`; `[*]` only for `slideUrls`) for an MCP that does not use the recommended names. Requires an `externalJobsByMissionType` entry for the Mission type. Replaces the former `publish.media`, which is now rejected. See the next section. |

Destinations are not declared: `targets` is rejected. Where content goes is chosen on the Mission or Schedule among the channels of the Project's Publisher. `validateManifest` (`packages/agent-templates/src/publish-declaration.ts`) checks all of this at Activation and `pnpm template:validate` reports it with the manifest path.

#### Asynchronous MCP: produce, poll, fetch

A long render cannot be copied by the Agent: it stops at `in_progress` and never runs again. The contract for an MCP that produces media is three tools: a launch tool returning a job id (`runId`), a status tool (`get_run_status(runId)`, declared in `externalJobsByMissionType`, polled by OpenGroow) and a tool returning the media (`publish.resource.tool`, with the recommended names `videoUrl`, `coverUrl`, `imageUrl`, `slideUrls`).

1. The Agent calls the launch tool and writes an `in_progress` RunResult with `job` and `publishable` carrying **only the text part** (`kind`, `caption`, and optionally `title`, `tags`, `link`, `altText`, `metadata`). A media URL there is rejected: the media comes from the MCP.
2. OpenGroow polls the status tool until the job is terminal.
3. On `completed`, OpenGroow calls `resource.tool` **once** with `{ [idArg]: jobId }` and merges the media into the Agent's `publishable`. The Agent's text is never overwritten. OpenGroow holds no URL template: it only talks to the MCP through MCP tools.
4. OpenGroow validates the merged `publishable` (kind, URLs, `require`). The Mission becomes `needs_human_review`, or `failed` with a per-field message (`publishable.videoUrl is missing: tool "get_video" returned nothing at "videoUrl"`) when the tool failed or a media is missing or invalid; no partial `publishable` is kept. An unreachable MCP is retried on the next tick.

The URL is frozen at the end of the job and must stay valid until publication. The review shows the media from the `publishable` (never from `review.path`) for a Mission type that declares `publish`. A synchronous MCP is unchanged: the Agent sees the URLs in its own tool call and writes the whole `publishable`.

### 2. What the Agent writes

OpenGroow appends a `## Publishable` section to the Mission's `context.md` with the JSON Schema of the declared kind (and the fields listed in `require`), so your instructions need not restate it. The Agent sets `artifact.publishable` in its RunResult. It is required for `success` and `needs_human_review` (both reach the review that publishes it). It carries references and text only, never content. Strict object: an unknown field is rejected with a per-field error.

Required vs optional fields (source of truth: `apps/convex/publishable.ts`):

| `kind` | Required | Optional |
| --- | --- | --- |
| `video` | `videoUrl`, `caption` | `coverUrl`, `title` (max 500), `link`, `tags` (max 30), `metadata` |
| `image` | `imageUrl`, `caption` | `link`, `altText` (max 1000), `metadata` |
| `carousel` | `slideUrls` (1 to 20 URLs, in slide order), `caption` | `link`, `altText` (max 1000), `metadata` |

URLs (including `link`) are valid URLs of at most 2048 characters; `caption` is at most 5000. Per-target settings (TikTok privacy, Pinterest board...) come from the Publisher configuration, never from the Publishable; `metadata` is not forwarded.

### 3. What OpenGroow does per kind

All kinds go through Postiz `upload-from-url` then `POST /posts`.

- `video`: one media, `caption` as the text. `coverUrl` is uploaded and sent as the thumbnail where Postiz supports a cover image (YouTube only).
- `image`: one media. `altText` is sent as the image `alt`.
- `carousel`: the slides are uploaded **sequentially** (upload order is slide order) and sent as the media list of one post. `altText` is applied to every slide.

Optional fields a platform has no equivalent for are **ignored silently**; they do not fail the publication.

| Field | Instagram | TikTok | Pinterest | YouTube | Others |
| --- | --- | --- | --- | --- | --- |
| `caption` | caption | description | pin description | description | text |
| `title` | ignored | title (90) | pin title (100) | title (100) | ignored |
| `coverUrl` | ignored | ignored | ignored | thumbnail | ignored |
| `link` | ignored | ignored | pin destination | ignored | ignored |
| `altText` | image alt | ignored | ignored | ignored | Bluesky, Mastodon, Slack, Tumblr: alt; others ignore |
| `tags` | ignored | ignored | ignored | video tags | ignored |

Postiz documents Instagram and TikTok covers only as a timestamp in the video, not as an image, hence `coverUrl` is not forwarded there. Source: https://docs.postiz.com/public-api/providers/.

### 4. Worked example (a): a video MCP

Your MCP has a tool `produce_video` that renders a video and returns `{ "result": { "video": { "url": "https://cdn.acme.com/v/42.mp4" }, "cover": { "url": "https://cdn.acme.com/v/42.jpg" } } }`.

Manifest:

```json
{
  "missionTypes": [
    {
      "type": "make-video",
      "label": "Make a video",
      "payload": "{}",
      "agentsMd": "make-video.md",
      "publish": {
        "kind": "video",
        "require": ["title", "coverUrl"]
      }
    }
  ]
}
```

`make-video.md` (instructions): call `produce_video`; do **not** call any publishing tool; write a short `title` and a `caption`; return the RunResult.

What the Agent returns:

```json
{
  "status": "needs_human_review",
  "summary": "Video ready",
  "reviewQuestions": [],
  "artifact": {
    "external": { "service": "acme-video", "id": "42" },
    "publishable": {
      "kind": "video",
      "videoUrl": "https://cdn.acme.com/v/42.mp4",
      "coverUrl": "https://cdn.acme.com/v/42.jpg",
      "title": "3 tips to ...",
      "caption": "Watch till the end #tips"
    }
  }
}
```

If the Agent forgets `coverUrl`, it is told `artifact.publishable.coverUrl is required: Mission type "make-video" declares it in publish.require` and retries in the same Mission. On approval, OpenGroow uploads the video (and the cover for YouTube) to Postiz and posts it to the chosen channels.

### 5. Worked example (b): a carousel MCP returning an array of URLs

Your MCP has `make_carousel` returning `{ "result": { "slides": [ { "url": "https://cdn.acme.com/c/1.png" }, { "url": "https://cdn.acme.com/c/2.png" }, { "url": "https://cdn.acme.com/c/3.png" } ] } }`.

Manifest entry:

```json
"publish": {
  "kind": "carousel",
  "require": ["altText"]
}
```

The MCP is synchronous, so the Agent writes the text and copies the slide URLs in the order returned (they are 1 to 20, the first URL is the first slide):

```json
"publishable": {
  "kind": "carousel",
  "slideUrls": ["https://cdn.acme.com/c/1.png", "https://cdn.acme.com/c/2.png", "https://cdn.acme.com/c/3.png"],
  "altText": "A three-step recipe, one step per slide",
  "caption": "Save this for later"
}
```

The slides are uploaded one after the other, so the carousel keeps its order on the platform. A slide URL that Postiz cannot fetch fails the Publication with an explicit error, which can be retried on its own.

### 6. Remove publishing from the MCP and the instructions

A Mission type that declares `publish` **must not publish itself**:

- **The Agent never publishes.** Remove every call to a publishing tool from its `AGENTS.md` and tell it to return the `publishable` instead. Publication happens on the human `publish` action of the review, or automatically with `autoPublish`, executed by the Publisher.
- **No dual-write.** Remove the publishing settings from the MCP too (Postiz channel, board id, credentials, `pinterestBoardId`-style parameters) and from its dashboard and `statusCheck`. The Template must not both publish through the MCP and declare `publish`, or the deliverable would be posted twice.
- The destination is not chosen by the Agent: it comes from `payload.publishTargets` (keys of Publisher channels, always `<platform>:<handle>`, chosen by the human when creating the Mission or Schedule and editable in the review, no default). Remove target or board parameters from Mission and Schedule payload instructions and from the Mission type's payload fields accordingly.
- Keep the review's `publish` capability for the Mission type; the generic engine routes it to the Publisher instead of an MCP effect.

`article` publishing (GitHub, `seo`) is out of V1 and stays in its MCP.
