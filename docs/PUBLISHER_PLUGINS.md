# Writing a Publisher plugin

A Publisher plugin connects OpenGroow to one external publishing service (ADR-070). It is an isolated code module that exposes a few functions; the core calls them and owns everything else. Reference implementation: `packages/publisher/postiz` in the hub (groowhub). Contract: `packages/publisher-sdk`. The core's tests use a copy of it, `apps/convex/test/postiz_reference`, which is never shipped.

## Package layout

```
groowhub/packages/publisher/<service>/
  package.json            # name @opengroow/publisher-<service>; the SDK is only imported as types
  manifest.json           # id, name, contractVersion, postUrl template
  data/capabilities.json      # data file 1
  data/channel-options.json   # data file 2
  src/index.ts            # exports the plugin object
  src/<service>.ts        # the functions
  src/<service>.test.ts   # stubbed-fetch tests
```

The plugin must not import from `apps/*`. It receives everything through arguments.

## The function contract (`PublisherPlugin`)

| Member | Role |
| --- | --- |
| `id`, `name`, `contractVersion` | `id` is stored as the Publisher's `adapter`; `name` is used in user-facing messages; `contractVersion` is the SDK contract the plugin implements (`PUBLISHER_CONTRACT_VERSION`). All three come from `manifest.json`. |
| `testConnection(conn)` | Checks the URL and key. |
| `listChannels(conn)` | The service's destinations as `{ id, name, service, picture?, profile?, disabled? }`; `service` is the platform identifier used by the two data files. |
| `publish(conn, request)` | Uploads media, builds the platform settings (defaults overridden by `request.settings`), creates the post. Returns `{ externalId, status: "scheduled" \| "published" \| "pending" }`. |
| `findPost(conn, query)` | Reconciliation before a re-send: the post on `channelId` with that caption and date window, or `null`. Never match a post the service itself marked failed. |
| `getStatus(conn, externalId, around?)` | Where a post stands (`pending`, `scheduled`, `published`, `failed`). A post the service no longer knows is `failed`. |
| `postUrl?` | Optional template (data, not a function), from `manifest.json`: `{url}` is the connection URL, `{id}` the post's external id. A URL that opens the post in the service's own UI (Postiz: `{url}/p/{id}`, its public preview page), shown as "open in <name>" next to the post's network URL. Rendered with the SDK's `renderPostUrl`. |

`findPost` receives, besides the caption and the attempt window, the channel's `channelService`, its `settings` and the `publishable` that was sent: a service that finds a post by what it carries (the Blog Utils (GitHub) Publisher looks for the file `<rootFolder>/<articlesFolder>/<slug>.md`) reads them. `getStatus` receives the channel (`target`: `channelId`, `settings`) when the post's id alone does not locate it (a commit sha needs its repository).

Every function returns `PublisherResult`: `{ ok: true, ... }` or `{ ok: false, error, uncertain? }`.

### Error classification: `uncertain`

Set `uncertain: true` whenever the failure does not prove the service rejected the request: a network error, a timeout, a 5xx or 408, an unreadable or unexpected answer **after** the post-creating call. A clear 4xx, or a failure before anything was created, is not uncertain. The core turns `uncertain` into the `uncertain` Publication status and runs `findPost` before it ever re-sends.

### `publish` request details

- `request.media`: media a previous attempt already uploaded (`{ url, id, path }`); reuse by source URL instead of uploading again.
- `request.beforePost(uploadedMedia)`: call it right before the call that creates the post, with the media uploaded so far. If it returns `false`, stop with an error: another caller owns this Publication. The core uses it to record the uploads and move the Publication to `submitting`.
- `request.publishAt`: absent means publish now. The core validates the date (never in the past); the plugin only maps it.
- `request.channelService`: the channel's platform when known from the mapping; fall back to `listChannels` if absent.

## The manifest

`manifest.json` is `{ id, name, contractVersion, postUrl?, icon?, scheduling? }`, read by the SDK's `parsePublisherManifest`, which refuses a package built for another contract version with a message naming both versions. A service that cannot publish at a later date declares `"scheduling": false`: the core then refuses a `publishAt` on its channels (Mission and Schedule create and edit, review, publish), and the plugin should refuse one too. It is the single source of the plugin's identity: `postiz.ts` builds `id`, `name`, `contractVersion` and `postUrl` from it, so a malformed manifest fails at load. It is also the data the core will store when packages are installed from the hub (ADR-072, proposed).

## The GitHub Publisher

`packages/publisher/github` in the hub (ADR-074), named **Blog Utils (GitHub)**, publishes `article` Publishables to the repository of a site built on blog-utils (ADR-075). Its connection URL is the REST API (`https://api.github.com`; `https://github.com` is read as it) and its key a GitHub token. A channel is a repository the token can push to (key `github:<owner>/<repo>`); its options are `branch` (empty: the default branch), `rootFolder` (where the site is in the repository, empty: its root) and, required and given from the root folder, `articlesFolder` and `coversFolder` (blog-utils imposes no articles directory, and where a site serves static files depends on its framework), `coversPath` (the covers' URL path written in the frontmatter, never derived from the folder) and `articleBaseUrl`. `publish` fetches the markdown and the cover without a key, then makes one commit with `<rootFolder>/<articlesFolder>/<slug>.md` (fixed frontmatter `title`, `description`, `publishedAt`, `cover` = `<coversPath>/<slug>.webp`, `category`; a frontmatter the markdown brings is replaced) and `<rootFolder>/<coversFolder>/<slug>.webp`. It never overwrites a file at the content path, fails with "cover not ready" when the cover cannot be fetched, and returns the commit sha with `<articleBaseUrl>/<slug>`. `publishedAt` is the commit's date (author and committer: the token's account, under its GitHub noreply address). `findPost` attaches the file at the content path only when its latest commit is not older than the attempt; an older file is someone else's, so the re-send fails on it instead. Its manifest declares `scheduling: false`.

## The two data files

- `capabilities.json`: `{ schemaVersion: 1, adapter, platforms: { <service>: { name, icon?, video, image, carousel, article, reasons? } } }` with levels `supported | uncertain | unsupported`. `unsupported` is set only when the service documents it; the core refuses it server-side and the dashboard disables the channel. A kind a platform does not mention is `uncertain`.
  - **`platforms` lists what OpenGroow offers** (ADR-075): a channel whose service is not a key of it is not shown in Add a channel, and `publishers.addChannel` refuses it. Declare only the platforms you have tried.
  - **`icon`** is the platform's logo, shipped in the package (a png, webp, jpeg or svg data URI, same limit as the manifest `icon`). The dashboard shows it for the platform's channels with no request; without it, the package icon. A Publisher with a single platform that is the service itself (GitHub) leaves it out.
- `channel-options.json`: `{ schemaVersion: 1, adapter, platforms: { <service>: ChannelOption[] } }` with option types `select | boolean | text`. The dashboard renders them on the Publishers page; the chosen values arrive in `request.settings`.
  - A `text` option may be `required: true` when the plugin cannot publish without it (ADR-075). Until it has a value the channel shows "Not configured" on the Publishers page, cannot be chosen for a Mission, and the core refuses to publish to it before creating any Publication. Its `placeholder` is only an example, never a value the plugin falls back to: a default belongs in the plugin, and the option is then not required.

Expose both on the plugin object (`capabilities`, `channelOptions`); the SDK provides `parseCapabilities` to validate the first.

### Platform identifiers

The keys of `platforms` (and each channel's `channelService`) are platform identifiers: `instagram`, `tiktok`, `pinterest`, `youtube`, `x`… A Template limits where its content goes with `publish.platforms`, and `template:validate` checks those values against `PLATFORM_IDS` in `@opengroow/publisher-sdk` (ADR-073). **A plugin that brings a platform not in that list adds its identifier to `PLATFORM_IDS`** (and the `@opengroow/groowhub-cli` bundle is republished), otherwise no Template can name it. A test pins the list to the reference Postiz capabilities. A channel matches a platform as is or by family (`instagram-standalone` is `instagram`).

## How the core calls the plugin

A plugin is not imported by the core: it is an **installed Publisher package** (ADR-072). Add publisher lists the hub's `publishers.json`, downloads the chosen package, verifies its digest and stores it (`hub_packages_node.install`). Installing derives the package's data once (`hub_package_kinds.describe`): the manifest, the capabilities and the channel options, which queries, mutations and the dashboard read (`publisher_packages.ts`, `api.publisher_packages.list`). The code (`dist/plugin.mjs`, whose default export is the plugin) is evaluated only in Node actions (`publisher/load_node.ts`, `loadPlugin(ctx, adapter)`), cached per digest.

So a function of the plugin can only be called from a `"use node"` action (`publisher_node.ts`, `publishers_node.ts`, `publication_polling_node.ts`); anything a query needs must be data in the manifest or the two data files. The core owns the Publication state machine, polling and retry reconciliation; the plugin never sets a Publication status.

A package is an `npm pack` tarball: `manifest.json`, `data/*.json`, `package.json` and the built `dist/plugin.mjs`. Its name must be `publisher-<manifest id>`. Only `official` hub entries can be installed: the code runs with the core's rights.

## Trying a package locally, before any release

The product reads the hub on GitHub. To try a package from a local checkout of the hub (`../groowhub`), without publishing anything:

```bash
pnpm publisher:pack ../groowhub/packages/publisher/postiz --out ../groowhub/dist --index ../groowhub/publishers.json        # bundle + npm pack into ../groowhub/dist, entry written to ../groowhub/publishers.json
pnpm hub:serve                                       # serves ../groowhub on http://127.0.0.1:8787
npx convex env set OPENGROOW_HUB_URL http://127.0.0.1:8787   # host Convex (pnpm dev)
```

With Convex in Docker (`pnpm dev:docker`), start `pnpm hub:serve -- --host 0.0.0.0` (it listens on 127.0.0.1 only by default) and set `OPENGROOW_HUB_URL=http://host.docker.internal:8787` on the `convex-backend` service instead. Then Publishers, Add publisher lists the local hub; choosing the package installs it, with the same digest check as from GitHub.

`OPENGROOW_HUB_URL` is accepted only for `localhost`, `127.0.0.1` or `host.docker.internal`, so it can never point a deployment at a remote server. Unset it to read the real hub again. Change the `--out` and `--index` paths for a hub that is not at `../groowhub`. `publisher:pack` is the hub CLI's `pack publisher` (`@opengroow/groowhub-cli`, the command the hub's release workflow runs); with `--index` it writes the index entry itself because nothing is released; in a real release a maintainer adds the entry in a reviewed PR and the workflow only moves `tag`, `asset` and `digest`.

`apps/convex/test/publisher_hub_chain.test.ts` runs this whole circuit automatically (pack, serve, catalogue, install, load, call) against a stubbed Postiz.

## Testing with a stubbed fetch

Plugins talk to the network through `fetch` only. Stub it and assert on the requests:

```ts
vi.stubGlobal("fetch", vi.fn(async (url, init) => new Response(JSON.stringify([{ postId: "p1" }]), { status: 200 })));
const res = await myPlugin.publish({ url: "https://svc.example.com", apiKey: "k" }, { channelId: "c", publishable: { kind: "image", imageUrl: "https://x/i.png", caption: "hi" } });
expect(res.ok).toBe(true);
```

See `packages/publisher/postiz/src/postiz.test.ts` in the hub. The core flows (retry, scheduling, polling) are covered with the same stub in `apps/convex/test/publication*.test.ts`; a new plugin should pass equivalent scenarios.

## Trust

Only official Publisher packages verified by the hub may contain code (ADR-070, ADR-072). They run in the core's process with its rights: there is no isolation, so an unverified third-party package must never be installable.
