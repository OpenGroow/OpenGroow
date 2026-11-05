# ADR-070: Publishers are declarative plugins distributed by the hub; the core keeps the Publication lifecycle

**Status:** Proposed

## Context

ADR-069 made the Publisher generic in concept and left the Postiz adapter inside Convex: `postiz.ts` (HTTP calls, error classification, `findPost`), `postiz_settings.ts` (per-platform defaults), `postiz.capabilities.json`, and, in the dashboard, `channel-options.ts`. Its capabilities amendment already says the JSON "is the shape a Publisher plugin will ship in the hub". A second service today means a new TypeScript adapter merged into the product, with the service-specific knowledge in Convex, which is exactly what the Template model forbids: "a Template does not contain arbitrary application code", "Convex holds no service-specific knowledge" (docs/domain/templates.md, ADR-020, ADR-021).

**Decision taken by the user (PR #25):** the Publisher leaves this repository and becomes a real plugin of the hub (`groowhub`), distributed like a Template (versioned package, `index.json`, sha256 digest, verification level, `@opengroow/template-validator`). It is a **declarative** plugin: a manifest of data that OpenGroow interprets. The core keeps the Publication lifecycle; the plugin provides calls and data.

### Options considered

- **An MCP server per service** (the publishing MCP of ADR-034, brought back) — rejected: it is code running outside, with its own deployment, auth and failure modes, and it re-creates the duplicated per-MCP configuration ADR-069 removed. The reconcile-before-resend guarantees would depend on every MCP author.
- **Sandboxed code in the package** (a JS/WASM module run in an isolate) — rejected for now: a sandbox, a capability API, resource limits and a review burden for code we cannot read quickly, to solve a problem one adapter does not yet have. Kept as a future option 2 if the step language below proves too small (see "Open questions").
- **Keep adapters in Convex, add them by PR** — rejected: every service is a product release and a Convex deploy, and the service knowledge stays in the core.
- **Declarative manifest interpreted by the core** — chosen.

## Decision

### 1. What a Publisher plugin is

A hub package of a new `kind: "publisher"` (the index entry gains `kind`, default `"template"`; the id scheme, `@opengroow/...` reserved scope, digest, `verification` levels and release flow of ADR-056/057/060 apply unchanged). Terminology: a **Publisher plugin** is a hub package; it is not an OpenClaw Plugin (code loaded in the gateway) and contains no code at all.

```
packages/publisher-postiz/
  package.json        # name "@opengroow/publisher-postiz", version, "opengroow": { "kind": "publisher", "manifest": "publisher.json" }
  publisher.json      # the manifest (data), schemaVersion 1
  logo.svg            # shown on the Publishers page (rendered through <img>, never inlined)
  tests/*.json        # conformance cases: stubbed HTTP exchanges -> expected requests and outcome
  README.md
```

The manifest is validated at hub CI time and again at install time by the same code, in `@opengroow/template-validator`, which gains a `publisher` command and a `kind` check on `index.json`. An installed plugin is stored in Convex (id, version, digest, manifest) like an installed Template; a Project's Publisher references `id@version` and is **pinned**: it never changes version by itself.

### 2. The manifest

Top level, versioned by `schemaVersion` (the core supports a closed list of versions and refuses others at install):

| Key | Content |
| --- | --- |
| `schemaVersion`, `id`, `name`, `logo` | Identity. `name` is used in every user-facing message ("Postiz may have received this post"). |
| `connection` | The fields the Publisher page asks for: `url` (label, placeholder) and `secrets` (`apiKey`). Secrets are write-only: never returned to the dashboard (as the Agent `apiKey` today). |
| `api` | `basePath`, `auth` (the **only** place a secret may be interpolated, into one named header), `errors` (classification, hints), `tables` (lookup tables, see filters). |
| `platforms` | Per service identifier (the channel's `service`): the capability entry exactly as `postiz.capabilities.json` has it today (`name`, `video`/`image`/`carousel` = `supported\|uncertain\|unsupported`, `reasons`) plus `options` (dashboard form), `settings` (rules building the post settings) and `require`. |
| `post` | How an item of a service's post list becomes `{externalId, status, externalUrl?}` (used by `findPost` and `getStatus`). |
| `operations` | `testConnection`, `listChannels`, `publish`, `getStatus`, optional `findPost`. |

**Network scope.** Every call goes to `connection.url` (origin plus path prefix) + `api.basePath` + the step's relative `path`. The origin cannot be changed by interpolation, redirects are not followed, an absolute URL in `path` is a validation error. There is no other host.

**Channel options** are what `channel-options.ts` holds, moved: `{ key, label, type: "select"|"boolean"|"text", options?, default?, placeholder?, kinds? }`. The three types are a closed set owned by the core (adding one is a product change, as adding a Publishable kind is). New: `kinds` restricts an option, and its default, to some Publishable kinds (TikTok `duet`/`stitch` apply to `video` only, which the dashboard today shows for every kind and the adapter encodes in code).

**Settings** replace `postiz_settings.ts`. The settings object of a post is built by the core in this order, each layer shallow-merged over the previous: `api`-level `settings.base`, option defaults (kinds-filtered), the platform's `settings` rules in order (`{ when?, set }`), then the settings **stored on the channel** (the human's values always win), then `require` (`[{ key, error }]`: a missing or falsy key fails with `error`, Pinterest `board`).

### 3. The step language

Small, bounded, interpreted. It reuses what exists: `{ref}` interpolation and dotted response paths (`responseIdField`) from ADR-021's `ActivationEffect`, JSON body templates from `BoundedHttpEffect`, "a reference with no value is omitted" from the run-context grammar (#659), `method`/`path`/`body` naming, and the rule that interpolation is text substitution, never code.

**References** are `{name.path.to[0].field}`, resolved against the operation's inputs and the bindings of earlier steps. **Typed substitution (new, needed):** a string that is exactly one reference (`"{settings}"`, `"{slides}"`) is replaced by the JSON value itself (object, array, boolean, number), where `ActivationBodyNode` only substitutes into strings. A key whose value resolves to *absent* is dropped from its object. Values substituted are never evaluated again.

**Filters** (new, closed list), `{ref | filter | filter:arg}`; an arg is a literal or `@ref`: `string`, `boolean` (absent unless that JSON type), `trim`, `nonBlank` (absent if blank), `max:N` (truncate), `default:x` (empty literal allowed), `iso` (epoch ms to ISO 8601), `epoch` (ISO to epoch ms, absent if unparsable), `plus:D`, `minus:D` (`30s`, `2m`, `1d` or ms), `min:@ref`, `max:@ref`, `htmlText` (strip tags, decode common entities, collapse whitespace), `table:name` (lookup in `api.tables`, absent if no entry). Nothing else: no arithmetic expressions, no regex, no string concatenation beyond `{a}{b}` templates.

**Node forms in body/`set`/`returns`** (new, three reserved keys): `{"$when": {"<ref>": [values...]}, "value": ...}` (value only if every ref is one of the values, else absent); `{"$map": {"over": ref, "as": name, "to": node, "requires": [refs], "omitIfEmpty": bool}}` (item skipped when a required ref is absent); and typed substitution above. There is no `$if/else`, no loop construct besides `$map`/`foreach`.

**Steps** of an operation run sequentially:

- `{ "call": { method, path, query?, headers?, body?, "commit"?: true }, "as": name, "expect"?: {...}, "when"?: {...} }` — one HTTP call with JSON in and JSON out. `as` binds the parsed response. `headers` may interpolate non-secret references only. `when` is `{ "in": {ref: [values]}, "present": [refs] }`.
- `{ "foreach": { "over": ref, "as": name, "steps": [call], "yield": node, "into": name } }` — **sequential** (order is the slide order) over a list from the inputs; `yield` per item builds the list bound to `into`. One level, no nesting, max 20 items.
- On a `call` inside a `foreach`, `"reuse": { "key": ref, "keep": {k: ref} }`: the **core** looks `key` up in the Publication's stored uploads and, if present, skips the call and binds the kept object; otherwise it calls, evaluates `keep` against `{response...}`, stores it on the Publication and binds it. A `keep` value that resolves absent is an "unexpected response" error.
- `{ "find": { "in": ref, "as": name, "where": predicate, "excludeStatus"?: [...] } }` — first item of a list matching a predicate; predicates are `all`, `any`, `eq: [a, b]`, `within: [value, from, to]`, `present: ref`. With `onMissing` giving the operation's output for no match.
- `commit: true` marks the **one** call of `publish` that creates the external effect (the post). It is the point of no return, see section 5.

Operations end with `assert` (`{ that, equals, error }`) and/or `returns` (a typed node whose shape the core validates, with `onInvalid` as message).

**Error classification** is core policy with plugin data: a network error, a timeout, a 5xx, 408 and an unreadable body mean `uncertain`; a 4xx other than 408 means `rejected` (so `failed`); `api.errors` can adjust the status sets and add per-status `hints` (" (check the API key)"). A response that fails `returns`/`keep` validation is `uncertain` **after** the `commit` call and `failed` before it (nothing was created at the post level). This is today's behavior (`call()` in `postiz.ts`) made data.

**Deliberately not supported:** user code, expressions, regex, loops other than the two above, recursion, parallel calls, more than 16 calls per operation, a second host, redirects, non-JSON bodies (no multipart, no binary, no XML), OAuth flows and token refresh (a static API key or bearer only), webhooks (the core polls), state kept by the plugin (except the reuse store), reading anything the inputs do not contain. Response bodies above 1 MiB and calls over 60 s are errors.

### 4. Interface between core and plugin

Inputs handed to every operation: `connection.url`, `secret.apiKey` (usable only in `api.auth`), `now` (epoch ms, injected so tests are deterministic).

| Operation | Extra inputs | Output expected |
| --- | --- | --- |
| `testConnection` | none | ok, or an error |
| `listChannels` | none | `{id, name, service, picture?, profile?, disabled?}[]` |
| `publish` | `channel {id, name, service, profile?}`, `publishable` (closed format, validated), `media.urls` (the media references in posting order, **computed by the core** per kind: `imageUrl`, `videoUrl` or `slideUrls`), `mode` (`schedule\|now`), `date` (`publishAt ?? now`), `settings` (built as above), `uploaded` (store of earlier uploads, by `reuse`) | `{externalId, status: scheduled\|published, externalUrl?}` |
| `findPost` | `channel`, `publishable.caption`, `attempt {startedAt, date}` | `{post: {externalId, status, externalUrl?} \| null}` |
| `getStatus` | `externalId`, `around` (the scheduled date, or `now`) | `{status: scheduled\|published\|failed\|pending, externalUrl?, error?}`; a post that cannot be found is declared `onMissing` (Postiz: `failed`) |

The core (never the plugin) owns: Publication statuses and transitions (`pending`, `submitting`, `uncertain`, `scheduled`, `published`, `failed`), the claim before the commit call (`markSubmitting`: only one caller wins, the others get "already being sent"), the attempt window, **reconcile-before-resend** (an `uncertain`, or `failed` with an attempt window and no post id, calls `findPost` first: a match is attached and nothing is sent, an unreadable listing keeps `uncertain`, no match sends once), the `done` rule of a Mission (all `published`, `uncertain` blocks), the polling cron and its cadence, the 5-minute stale-row recovery, `publishAt` rules, capability refusal (`unsupported`) and the `uncertain` wording. The plugin owns: which calls, in which order, with which bodies, how responses become the typed outputs, and the data tables.

**Media reuse on retry.** `UploadedMedia {url,id,path}` is generalized to `{key, data}` (`key` = the `reuse.key`, the source URL; `data` = what `keep` returned); existing rows read as `key=url`, `data={id,path}`. Between the last upload and the `commit` call the core persists the store (today's `beforePost`); a retry hands it back as `uploaded`, and `reuse` skips the matching calls.

**Legacy mappings without `channel.service`** (publish today lists channels to find it): the core calls `listChannels` once and fills `channel.service`; it is not a plugin concern.

**A plugin without `findPost`** has no auto-reconciliation: a retry of an `uncertain` Publication stays refused unless the manifest declares `api.idempotencyKey` (header name), in which case the core sends the stable `publication.id` as that header and a re-send is safe. See the second example.

### 5. The Postiz plugin (proof of the format)

Faithful to `postiz.ts`, `postiz_settings.ts`, `postiz.capabilities.json` and `channel-options.ts`. The capability table is the existing file's `platforms` object verbatim; it is abridged to the platforms that also carry options or settings (the others keep only `name`/capabilities, unchanged).

```json
{
  "schemaVersion": 1,
  "id": "@opengroow/publisher-postiz",
  "name": "Postiz",
  "logo": "logo.svg",
  "connection": {
    "url": { "label": "Postiz URL", "placeholder": "https://postiz.example.com" },
    "secrets": { "apiKey": { "label": "API key" } }
  },
  "api": {
    "basePath": "/api/public/v1",
    "auth": { "header": "Authorization", "value": "{secret.apiKey}" },
    "errors": { "hints": { "401": " (check the API key)", "403": " (check the API key)" } },
    "tables": {
      "postState": { "PUBLISHED": "published", "ERROR": "failed", "QUEUE": "scheduled" },
      "publishStatus": { "schedule": "scheduled", "now": "published" }
    },
    "settings": { "base": { "__type": "{channel.service}" } }
  },

  "platforms": {
    "x": { "name": "X", "video": "supported", "image": "supported", "carousel": "supported" },
    "reddit": { "name": "Reddit", "video": "supported", "image": "supported", "carousel": "unsupported",
                "reasons": { "carousel": "Reddit media posts take exactly one attachment" } },
    "youtube": {
      "name": "YouTube", "video": "supported", "image": "unsupported", "carousel": "unsupported",
      "reasons": { "image": "YouTube only takes a video", "carousel": "YouTube only takes a video" },
      "settings": [ { "set": {
        "title": "{publishable.title | trim | nonBlank | max:100}",
        "tags": { "$map": { "over": "{publishable.tags}", "as": "t", "requires": ["{t | string | nonBlank}"],
                            "to": { "value": "{t}", "label": "{t}" }, "omitIfEmpty": true } },
        "thumbnail": "{thumbnail}"
      } } ]
    },
    "instagram": {
      "name": "Instagram", "video": "supported", "image": "supported", "carousel": "supported",
      "options": [ { "key": "post_type", "label": "Post type", "type": "select", "default": "post",
                     "options": [ { "value": "post", "label": "Feed post or Reel" }, { "value": "story", "label": "Story" } ] } ],
      "settings": [ { "set": { "is_trial_reel": false, "collaborators": [] } } ]
    },
    "instagram-standalone": {
      "name": "Instagram", "video": "supported", "image": "supported", "carousel": "supported",
      "settings": [ { "set": { "post_type": "post", "is_trial_reel": false, "collaborators": [] } } ]
    },
    "tiktok": {
      "name": "TikTok", "video": "supported", "image": "supported", "carousel": "supported",
      "options": [
        { "key": "privacy_level", "label": "Visibility", "type": "select", "default": "PUBLIC_TO_EVERYONE",
          "options": [ { "value": "PUBLIC_TO_EVERYONE", "label": "Everyone" }, { "value": "MUTUAL_FOLLOW_FRIENDS", "label": "Friends (mutual follows)" },
                       { "value": "FOLLOWER_OF_CREATOR", "label": "Followers" }, { "value": "SELF_ONLY", "label": "Only me" } ] },
        { "key": "content_posting_method", "label": "Posting method", "type": "select", "default": "DIRECT_POST",
          "options": [ { "value": "DIRECT_POST", "label": "Publish directly" },
                       { "value": "UPLOAD", "label": "Send to the TikTok inbox (publish it in the app within 24h)" } ] },
        { "key": "comment", "label": "Allow comments", "type": "boolean", "default": true },
        { "key": "duet", "label": "Allow duets", "type": "boolean", "default": true, "kinds": ["video"] },
        { "key": "stitch", "label": "Allow stitches", "type": "boolean", "default": true, "kinds": ["video"] }
      ],
      "settings": [
        { "set": { "brand_content_toggle": false, "brand_organic_toggle": false,
                   "title": "{publishable.title | trim | nonBlank | max:90}" } },
        { "when": { "in": { "publishable.kind": ["image", "carousel"] } }, "set": { "autoAddMusic": "no" } }
      ]
    },
    "pinterest": {
      "name": "Pinterest", "video": "uncertain", "image": "supported", "carousel": "uncertain",
      "reasons": { "video": "A Pinterest video pin needs a cover image; the Postiz provider page does not document it",
                   "carousel": "Pinterest takes up to 5 images, but the Postiz provider page does not document it" },
      "options": [ { "key": "board", "label": "Board ID", "type": "text", "placeholder": "1234567890123456789" } ],
      "settings": [ { "set": { "title": "{publishable.title | trim | nonBlank | max:100}",
                               "link": "{publishable.link | trim | nonBlank | max:2048}" } } ],
      "require": [ { "key": "board", "error": "Pinterest needs a board: set the Board ID of this channel on the Publishers page" } ]
    }
  },

  "post": {
    "externalId": "{p.id}",
    "status": "{p.state | table:postState | default:pending}",
    "externalUrl": "{p.releaseURL | string | nonBlank}",
    "failure": "Postiz could not publish the post"
  },

  "operations": {
    "testConnection": {
      "steps": [ { "call": { "method": "GET", "path": "is-connected" }, "as": "res" } ],
      "assert": [ { "that": "{res.connected}", "equals": true, "error": "Postiz did not confirm the connection" } ]
    },

    "listChannels": {
      "steps": [ { "call": { "method": "GET", "path": "integrations" }, "as": "res",
                   "expect": { "array": "res", "error": "Postiz returned an unexpected channel list" } } ],
      "returns": { "channels": { "$map": { "over": "{res}", "as": "c", "requires": ["{c.id | string}"], "to": {
        "id": "{c.id}",
        "name": "{c.name | string | default:@c.id}",
        "service": "{c.identifier | string | default:unknown}",
        "picture": "{c.picture | string}",
        "profile": "{c.profile | string | nonBlank}",
        "disabled": "{c.disabled | boolean}" } } } }
    },

    "publish": {
      "steps": [
        { "foreach": { "over": "{media.urls}", "as": "url", "into": "uploaded_media",
          "steps": [ { "call": { "method": "POST", "path": "upload-from-url", "body": { "url": "{url}" } }, "as": "up",
                       "reuse": { "key": "{url}", "keep": { "id": "{response.id | string}", "path": "{response.path | string}" } },
                       "onInvalid": "Postiz returned an unexpected upload response" } ],
          "yield": { "id": "{up.id}", "path": "{up.path}",
                     "alt": { "$when": { "publishable.kind": ["image", "carousel"] }, "value": "{publishable.altText | string | nonBlank}" } } } },

        { "when": { "in": { "channel.service": ["youtube"] }, "present": ["publishable.coverUrl"] },
          "call": { "method": "POST", "path": "upload-from-url", "body": { "url": "{publishable.coverUrl}" } }, "as": "thumbnail",
          "reuse": { "key": "{publishable.coverUrl}", "keep": { "id": "{response.id | string}", "path": "{response.path | string}" } },
          "onInvalid": "Postiz returned an unexpected upload response" },

        { "call": { "method": "POST", "path": "posts", "commit": true, "body": {
            "type": "{mode}",
            "date": "{date | iso}",
            "shortLink": false,
            "tags": [],
            "posts": [ { "integration": { "id": "{channel.id}" },
                         "value": [ { "content": "{publishable.caption | string | default:}", "image": "{uploaded_media}" } ],
                         "settings": "{settings}" } ] } },
          "as": "posted" }
      ],
      "returns": { "externalId": "{posted[0].postId | string}", "status": "{mode | table:publishStatus}" },
      "onInvalid": "Postiz returned an unexpected response when creating the post"
    },

    "findPost": {
      "steps": [
        { "call": { "method": "GET", "path": "posts", "query": {
            "startDate": "{attempt.startedAt | min:@attempt.date | minus:1d | iso}",
            "endDate": "{attempt.date | max:@now | plus:1d | iso}" } }, "as": "res",
          "expect": { "array": "res.posts", "error": "Postiz returned an unexpected post list" } },
        { "find": { "in": "{res.posts}", "as": "p", "excludeStatus": ["failed"], "where": { "all": [
            { "present": "{p.id | string}" },
            { "eq": ["{p.integration.id}", "{channel.id}"] },
            { "eq": ["{p.content | htmlText}", "{publishable.caption | htmlText}"] },
            { "any": [
              { "within": ["{p.createdAt | epoch}", "{attempt.startedAt | minus:2m}", "{now | plus:2m}"] },
              { "within": ["{p.publishDate | epoch}", "{attempt.startedAt | minus:2m}", "{now | plus:2m}"] },
              { "within": ["{p.publishDate | epoch}", "{attempt.date | minus:2m}", "{attempt.date | plus:2m}"] } ] } ] } },
          "bind": "hit", "onMissing": { "post": null } }
      ],
      "returns": { "post": "{hit}" }
    },

    "getStatus": {
      "steps": [
        { "call": { "method": "GET", "path": "posts", "query": {
            "startDate": "{around | minus:2d | iso}",
            "endDate": "{around | max:@now | plus:2d | iso}" } }, "as": "res",
          "expect": { "array": "res.posts", "error": "Postiz returned an unexpected post list" } },
        { "find": { "in": "{res.posts}", "as": "p", "where": { "eq": ["{p.id}", "{externalId}"] } },
          "bind": "hit", "onMissing": { "post": { "status": "failed", "error": "The post no longer exists in Postiz" } } }
      ],
      "returns": { "post": "{hit}" }
    }
  }
}
```

How it maps to today's code, including what does not map one to one:

- `mediaReferences` moves to the core (`media.urls`); the `"missing media reference"` error is the core's.
- The optional-field omission of `postizSettings` (`title`, `link`, `tags`, `thumbnail` only when present) is the "absent drops the key" rule; `max:N` after `trim | nonBlank` reproduces `text(value, max)`.
- TikTok `title` is `max:90` where the code sliced 100 then 90: same result.
- `duet`/`stitch` for `video`, `autoAddMusic: "no"` otherwise: `kinds` on the option defaults plus a `when` rule.
- `thumbnail` is a binding produced by a conditional step and read by YouTube's `settings`; if the step does not run the key is absent, as today.
- `status` of the outcome comes from `mode` through a table instead of the `scheduled ? ... : ...` ternary.
- The `beforePost` hook becomes the `commit` flag; the core claims the Publication when it reaches that call.

### 6. A second, non-Postiz example (one call, service-side idempotency)

A hypothetical `@acme/publisher-chirp`: a text-and-media "create post" API with a bearer token, an idempotency header and a per-post read.

```json
{
  "schemaVersion": 1, "id": "@acme/publisher-chirp", "name": "Chirp", "logo": "logo.svg",
  "connection": { "url": { "label": "Chirp URL" }, "secrets": { "apiKey": { "label": "Token" } } },
  "api": { "basePath": "/v1", "auth": { "header": "Authorization", "value": "Bearer {secret.apiKey}" },
           "idempotencyKey": "Idempotency-Key",
           "tables": { "state": { "live": "published", "queued": "scheduled", "rejected": "failed" },
                       "publishStatus": { "schedule": "scheduled", "now": "published" } } },
  "platforms": { "chirp": { "name": "Chirp", "video": "supported", "image": "supported", "carousel": "unsupported",
                            "reasons": { "carousel": "Chirp posts take at most one attachment" } } },
  "post": { "externalId": "{p.id}", "status": "{p.status | table:state | default:pending}", "externalUrl": "{p.url | string}" },
  "operations": {
    "testConnection": { "steps": [ { "call": { "method": "GET", "path": "me" }, "as": "r" } ],
                        "assert": [ { "that": "{r.active}", "equals": true, "error": "Chirp did not accept the token" } ] },
    "listChannels": { "steps": [ { "call": { "method": "GET", "path": "accounts" }, "as": "r" } ],
                      "returns": { "channels": { "$map": { "over": "{r.accounts}", "as": "a",
                        "to": { "id": "{a.id}", "name": "{a.display}", "service": "chirp", "profile": "{a.handle}" } } } } },
    "publish": {
      "steps": [ { "call": { "method": "POST", "path": "statuses", "commit": true, "body": {
          "text": "{publishable.caption}", "account": "{channel.id}",
          "media_urls": "{media.urls}", "publish_at": "{date | iso}" } }, "as": "s" } ],
      "returns": { "externalId": "{s.id | string}", "status": "{mode | table:publishStatus}" }
    },
    "getStatus": {
      "steps": [ { "call": { "method": "GET", "path": "statuses/{externalId}" }, "as": "p" } ],
      "returns": { "post": { "status": "{p.status | table:state | default:pending}", "externalUrl": "{p.url | string}" } }
    }
  }
}
```

No upload step, no `foreach`, no settings rules, no `findPost`: because `api.idempotencyKey` is declared, the core sends the stable `publication.id` as the header and a re-send after `uncertain` is safe. Every construct is one already used by the Postiz plugin.

### 7. Security model

- **Secrets.** The API key lives in Convex, encrypted as today, and is exposed to the interpreter only as `secret.*`, which the validator and the runtime accept in `api.auth` **only**: not in `path`, `query`, `body`, `headers`, `returns`, error messages. Responses and errors are never logged with request headers. The dashboard sees `connected: boolean`, never the key.
- **Network scope.** One origin, the Project's `connection.url`; no redirects; the plugin cannot name another host. The URL itself is user-provided and carries today's SSRF exposure (a self-hosted Postiz on a private network is a legitimate target); a private-address policy for hosted deployments is a separate decision.
- **Interpolation safety.** Substitution happens on the parsed JSON tree, never by string concatenation into JSON, so a caption cannot break out of the body. Values in `path` are URL-encoded, `query` is built with a query encoder, header values reject CR/LF, substituted values are never re-evaluated, response paths reject `__proto__`/`constructor`, and there are step, size and time limits (section 3).
- **What a malicious manifest could do:** send the Publishable (caption, media URLs) and the API key (in the auth header) to the host the user configured, which is the purpose of any connector; ask that host to fetch arbitrary URLs (`upload-from-url`: the fetch is made by the service, not by Convex); report false statuses (`published` for nothing) or false capabilities; show a misleading option label or logo; burn its time budget. **What it could not:** call any other host, read another Project's data or any secret other than its own key, put the key anywhere but the auth header, execute code, change Publication transitions, skip the claim or the reconcile-before-resend, or see data outside its operation inputs. Rendering of manifest text is plain text; `logo` and channel `picture` go through `<img>` with an `https:` check.
- **Verification levels.** Same as Templates: `official` (the `@opengroow` scope, public hub), `verified`, `community`; digest checked on every install. Installing a non-official Publisher plugin shows its host-scope rule, the operations and that captions and media URLs will be sent to the configured URL, and requires explicit consent. A level is a label, not a permission.
- **Validation (template-validator extension).** Schema check per `schemaVersion` with unknown keys rejected (as `targets` is), the rules above (secret location, no absolute `path`, one `commit` call in `publish`, filters and node forms from the closed lists, bounded step counts, tables referenced exist, `returns` shape matches the operation's typed output, option types closed), capability levels and the `platforms` shape through the existing `parseCapabilities` rules, and a run of `tests/*.json` conformance cases against the interpreter (stubbed exchanges to expected requests and outcome).

## Consequences

- Builds on ADR-069 and keeps its guarantees; the capability amendment's "file move" becomes real. Consistent with ADR-034 (config in the owning place: now the Project's Publisher with a pinned plugin), ADR-010 (references only, unchanged), ADR-051 (a closed allow-list validated at install, same philosophy as `analysisSchema`) and ADR-020/021 (declarative effect, no service branch in Convex). ADR-057/060 cover distribution; the Postiz plugin is `official` and installed on demand, so a fresh install has no publisher until it is installed (the bootstrap question in "Open questions").
- New components: the interpreter and manifest types in a shared package (used by Convex, the validator and hub CI), a `publishers` registry of installed plugins, a `kind` in `index.json`, a `publisher` command in the validator, and a data-driven `capabilityOf` and option form (the dashboard can no longer import a bundled JSON; it reads the installed manifest through a query).
- `PublisherAdapter` stays as the interface the core calls; the interpreter is its only implementation. `UploadedMedia` is generalized and `UNCERTAIN_MESSAGE` uses the plugin name.
- Adding a service is a hub PR, not a product release. The cost is a language to maintain and keep small.
- Existing Projects have `adapter: "postiz"`; it resolves to `@opengroow/publisher-postiz` through an alias (as `@megaclaw` ids in ADR-056).

## Migration plan

Each step is shippable and behavior-preserving; the existing fetch-stubbed tests (`apps/convex/test/`) are the safety net.

1. **Interpreter, no Postiz yet.** Package with manifest types, the validator and the interpreter (references, filters, node forms, steps, classification), pure and fetch-injected. Own unit tests per primitive. No existing test is touched.
2. **Postiz as a manifest, in this repo, behind `PublisherAdapter`.** Write `publisher.json` next to the code and `manifestAdapter(manifest)`. Add a temporary **parity test**: every scenario of the existing Postiz suites runs against both adapters over the same fetch stub and must produce identical requests (method, URL, headers, body, order) and outcomes. Guarding tests: `publications.test.ts` (publish, settings, state transitions), `postiz_publishable_fields.test.ts` (`altText`, `link`, `tags`, `coverUrl`, per-platform settings), `publication_retry.test.ts` (`submitting`/`uncertain`, `findPost`, media reuse, double click), `publication_scheduling.test.ts` (`scheduled`, polling, `getStatus`), `auto_publish_chain.test.ts`, `publishers.test.ts` (listChannels, connection). Switch `adapterFor` to the interpreter when parity is green.
3. **Core generalizations.** `UploadedMedia` to `{key,data}` with the read-compat of old rows; `commit` replaces `beforePost`; plugin name in messages; core-computed `media.urls`; `api.idempotencyKey`. Guard: `publication_retry.test.ts` plus a migration test on an old row.
4. **Capabilities and channel options move into the manifest.** `capabilityOf` reads installed manifests; the dashboard reads `platforms[service].options` (with `kinds`) from a query; `channel-options.ts` and `postiz.capabilities.json` become the manifest content. Guards: `publisher_capabilities.test.ts`, `publish_capability_create.test.ts`, a snapshot test that the manifest's capability table equals the old JSON, and a dashboard test for the option form.
5. **Hub.** Create `packages/publisher-postiz` in groowhub, `kind` in `index.json` and `tools/update-index.mjs`, the validator's `publisher` command and its CI step, conformance cases in `tests/` derived from the parity scenarios, release `publisher-postiz@1.0.0`, add the `official` index entry in a reviewed PR. Product side: install a `kind: "publisher"` package from the hub (digest-checked), registry, Publishers page picks an installed plugin.
6. **Remove the in-repo adapter.** Delete `postiz.ts`, `postiz_settings.ts`, `postiz.capabilities.json`, `channel-options.ts`, `PUBLISHER_ADAPTER_IDS` and the parity test; keep the stubbed scenarios as the conformance cases of the hub package and as the integration suite of the core with a fixture plugin. Update docs/domain/publishing.md ("Postiz translation" moves to the plugin README).

## Open questions and risks

- **Expressiveness.** Postiz fits, but it needed additions beyond the existing external-effect vocabulary: typed whole-value substitution, filters (including date arithmetic and `htmlText`, which exist because Postiz stores captions as HTML and its API lists posts only by date), `$when`/`$map`, `foreach` with core-managed `reuse`, `find` with predicates, and the `commit` marker. These are the minimal set found; each is generic but each was shaped by this one service. A service needing pagination, multipart uploads, polling an upload job, OAuth refresh or a second dependent call per item will not fit; that is the signal for the sandboxed-code option 2, not for growing the language indefinitely. Rule: a new primitive needs a second real service that requires it.
- **Debuggability.** A declarative flow fails far from where it was written. Mitigations: conformance cases in the package, a `publisher test` command running them locally, step-level traces (step id, redacted request, status, which reference was absent) kept on the Publication error for the human, and a dry-run mode that evaluates `publish` up to the `commit` call without sending.
- **Core/plugin compatibility.** `schemaVersion` is a hard gate: a core supports a list of versions, an `index.json` entry should carry the required version so the dashboard can hide plugins the core cannot run, and a Project's pinned plugin must keep working across core upgrades (the core supports old versions for a stated period). Plugin updates are explicit, never automatic, because they change what is sent.
- **Dashboard forms.** Option forms are rendered from a closed set (`select`, `boolean`, `text`). Anything richer (a board picker fetched from the service, conditional fields, validation of a Board ID) needs either a new core type or a new operation (`listOptions`); not decided. Per-kind visibility (`kinds`) is part of v1.
- **Bootstrap.** Official plugins are installed on demand (ADR-057), so Publishing needs the hub reachable once. Whether Postiz is bootstrapped from a pinned release like `@opengroow/source` is undecided.
- **Services without `findPost` or idempotency.** The core refuses to re-send an `uncertain` Publication; whether the human may then confirm or discard it by hand is a product decision to take with the first such service.
- **Fidelity to unverified facts.** The field names and capabilities copied from the Postiz docs are not yet checked against a live instance (docs/domain/publishing.md); moving them to the hub does not change that, but a plugin version bump now fixes them without a product release.
