# ADR-074: A GitHub Publisher publishes site articles; `article` joins the Publishable kinds

**Status:** Proposed (amends ADR-069)

## Context

ADR-069 moved social publishing into a generic Publisher and left one exception: article publishing (a markdown page and its cover committed to a site's GitHub repository) stayed in the MCP that produces the article, out of V1. That MCP therefore still holds a GitHub token and the repository layout, which is the duplication ADR-069 set out to remove.

## Decision

- **A `publisher-github` Publisher plugin** (hub package, ADR-072), built like Postiz. Its connection is a GitHub token. A channel is one repository, key `github:<owner>/<repo>`; it writes to a site built on `@megaclaw/blog-utils` (named **Blog Utils (GitHub)**, ADR-075), and its channel options are `branch`, then `articlesFolder` and `coversFolder` from the root of the repository (blog-utils imposes no directory), `coversPath` (the URL path written in the frontmatter, never derived from the folder) and `articleBaseUrl`. `publish` makes one commit with `<articlesFolder>/<slug>.md` (fixed frontmatter: `title`, `description`, `publishedAt`, `cover`, `category`) and `<coversFolder>/<slug>.webp`. The Publication's `externalUrl` is `<articleBaseUrl>/<slug>`, its `externalId` the commit sha.
- **`article` joins the closed set of kinds**: `markdownUrl`, `coverUrl`, `slug`, `title`, `description`, optional `category`, references only (ADR-010). Capabilities: GitHub supports `article` only; every Postiz platform declares `article: unsupported`.
- **For `article`, the MCP owns the whole Publishable.** The Agent writes no part of it (a `publishable` in its RunResult is rejected); the Mission type's `publish.resource` returns all of it. This is a rule of the kind, not a manifest option: `video`, `image` and `carousel` keep ADR-069's split (Agent text, `resource` media).
- **Media are read without a key, at commit time.** The MCP serves the markdown and the cover on unauthenticated URLs; the plugin does a plain `fetch`, as Postiz does. Reading at commit time publishes the latest revision.
- **`onPublished` effect.** A Mission type that declares `publish` may declare `publish.onPublished` (`server`, `method`, `path`, `body`, `responseIndexingField`), called once when a Publication becomes `published`, so the producing service can follow up (its own status, indexing mirrored on the Mission as in ADR-015). The call never blocks: on failure the Mission still reaches `done`, shows a warning and offers to resend it; the receiving endpoint is expected to be idempotent.
- **No overwrite.** A first send that finds a file at `<contentBase>/<slug>.md` fails the Publication with an explicit message. When retrying an `uncertain` send, an existing file is our own post and is attached (`findPost` checks the path).
- **No scheduling for now.** GitHub cannot schedule a commit; the plugin declares it and `publishAt` is refused on a GitHub channel. `publishedAt` is the commit date.

## Considered options

- **Sending the MCP's key to read the markdown**, either inside the plugin request or through a core `fetchMedia` helper adding the Mission's Agent key. Not a security regression (the key is already plaintext in Convex, ADR-017, and the plugin runs with the core's rights), but rejected: a new mechanism for a single MCP, a departure from the "media are public URLs" convention Postiz relies on, and a delayed publish would fail once the Agent is deactivated or reactivated.
- **A manifest option choosing who owns the Publishable (`owns: media | all`)** or a fallback merge (Agent wins, `resource` fills the gaps). Rejected: no second case needs it, and a merge leaves no single owner for a field.
- **Scheduling held by the core** (`scheduled` Publication, `ctx.scheduler.runAt`) or a future `publishedAt` filtered by the site. Postponed.

## Consequences

- An MCP that published articles itself drops that code; projects add a GitHub Publisher. No dual write.
- Work that edits already published files (for example a pull request adding internal links) is not a Publication and stays in the MCP, which keeps its own repository access for it.
- The review of a Mission type publishing `article` shows the article from the `publishable` (ADR-069), so the dashboard needs a renderer for the kind.
- An unpublished article is readable by anyone holding its URL.
