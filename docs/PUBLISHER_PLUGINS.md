# Writing a Publisher plugin

A Publisher plugin connects OpenGroow to one external publishing service (ADR-070). It is an isolated code module that exposes a few functions; the core calls them and owns everything else. Reference implementation: `packages/publisher-postiz`. Contract: `packages/publisher-sdk`.

## Package layout

```
packages/publisher-<service>/
  package.json            # name @opengroow/publisher-<service>, depends on @opengroow/publisher-sdk
  tsconfig.json
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
| `id`, `name` | `id` is stored as the Publisher's `adapter`; `name` is used in user-facing messages. |
| `testConnection(conn)` | Checks the URL and key. |
| `listChannels(conn)` | The service's destinations as `{ id, name, service, picture?, profile?, disabled? }`; `service` is the platform identifier used by the two data files. |
| `publish(conn, request)` | Uploads media, builds the platform settings (defaults overridden by `request.settings`), creates the post. Returns `{ externalId, status: "scheduled" \| "published" \| "pending" }`. |
| `findPost(conn, query)` | Reconciliation before a re-send: the post on `channelId` with that caption and date window, or `null`. Never match a post the service itself marked failed. |
| `getStatus(conn, externalId, around?)` | Where a post stands (`pending`, `scheduled`, `published`, `failed`). A post the service no longer knows is `failed`. |
| `postUrl?(conn, externalId)` | Optional. A URL that opens the post in the service's own UI (Postiz: its public preview page `/p/<id>`), shown as "open in <name>" next to the post's network URL. |

Every function returns `PublisherResult`: `{ ok: true, ... }` or `{ ok: false, error, uncertain? }`.

### Error classification: `uncertain`

Set `uncertain: true` whenever the failure does not prove the service rejected the request: a network error, a timeout, a 5xx or 408, an unreadable or unexpected answer **after** the post-creating call. A clear 4xx, or a failure before anything was created, is not uncertain. The core turns `uncertain` into the `uncertain` Publication status and runs `findPost` before it ever re-sends.

### `publish` request details

- `request.media`: media a previous attempt already uploaded (`{ url, id, path }`); reuse by source URL instead of uploading again.
- `request.beforePost(uploadedMedia)`: call it right before the call that creates the post, with the media uploaded so far. If it returns `false`, stop with an error: another caller owns this Publication. The core uses it to record the uploads and move the Publication to `submitting`.
- `request.publishAt`: absent means publish now. The core validates the date (never in the past); the plugin only maps it.
- `request.channelService`: the channel's platform when known from the mapping; fall back to `listChannels` if absent.

## The two data files

- `capabilities.json`: `{ schemaVersion: 1, adapter, platforms: { <service>: { name, video, image, carousel, reasons? } } }` with levels `supported | uncertain | unsupported`. `unsupported` is set only when the service documents it; the core refuses it server-side and the dashboard disables the channel. Unknown platforms are `uncertain`.
- `channel-options.json`: `{ schemaVersion: 1, adapter, platforms: { <service>: ChannelOption[] } }` with option types `select | boolean | text`. The dashboard renders them on the Publishers page; the chosen values arrive in `request.settings`.

Expose both on the plugin object (`capabilities`, `channelOptions`); the SDK provides `parseCapabilities` to validate the first.

## How the core calls the plugin

`apps/convex/publisher/registry.ts` lists the plugins (`pluginFor(adapterId)`, `channelOptionsOf`). To register a new one, add the package as a dependency of `apps/convex` and `apps/dashboard` and one entry to `PLUGINS`; also add it to the COPY lines of the Dockerfiles (`apps/dashboard/Dockerfile`, `apps/convex/docker/bootstrap/Dockerfile`). `apps/convex/publisher/capabilities.ts` reads the plugin's capabilities. The core owns the Publication state machine, polling and retry reconciliation; the plugin never sets a Publication status.

## Testing with a stubbed fetch

Plugins talk to the network through `fetch` only. Stub it and assert on the requests:

```ts
vi.stubGlobal("fetch", vi.fn(async (url, init) => new Response(JSON.stringify([{ postId: "p1" }]), { status: 200 })));
const res = await myPlugin.publish({ url: "https://svc.example.com", apiKey: "k" }, { channelId: "c", publishable: { kind: "image", imageUrl: "https://x/i.png", caption: "hi" } });
expect(res.ok).toBe(true);
```

See `packages/publisher-postiz/src/postiz.test.ts`. The core flows (retry, scheduling, polling) are covered with the same stub in `apps/convex/test/publication*.test.ts`; a new plugin should pass equivalent scenarios.

## Trust

Only official Publisher packages verified by the hub may contain code (ADR-070). Loading plugins from the hub at runtime is not built yet; plugins are workspace packages for now.
