# ADR-010: Deliverable content stays in the external service — Megaclaw stores a pointer

**Status:** Accepted

### Context

The SEO agent generates articles via seo-mcp (an external service with its own PostgreSQL DB). The initial design had the agent fetch the Markdown content and write it into the OpenClaw Workspace (`missions/<missionId>/artifacts/article.md`), then the dashboard would read it from the Workspace.

In practice, seo-mcp did not provide a tool to fetch the article's content — it only returned `{ articleId, title }`. The agent therefore wrote `artifact.files: []`, leaving the review page unable to display the article.

### Decision

Content produced by an external service (Markdown article at seo-mcp, image at an image generator…) **does not transit through the OpenClaw Workspace**. Megaclaw only stores an `articleId` in `artifact.metadata`. The content is fetched **live** from the external service when the user needs it.

For the SEO case: a Convex action `getArticleContent(missionId)` calls a **REST HTTP route** of seo-mcp (with the `ProjectAgent`'s `apiKey` as `Authorization: Bearer`) and returns the current Markdown. The dashboard/Convex accesses seo-mcp over HTTP, never via MCP tool calling — see ADR-013.

### Reasons

1. **Single source of truth** — `revise_article` modifies the article in the seo-mcp DB. If we duplicated the content in the Workspace, the copy would be stale after the first revision.
2. **Clear integration boundary** (ADR-013) — agents consume seo-mcp via MCP tool calling, the dashboard/Convex via REST HTTP routes. In both cases the article stays at seo-mcp and is never duplicated in Megaclaw.
3. **Artifact = pointer, not container** — the Megaclaw domain model does not duplicate external services' content.

### Consequences

- `FileEntry` is removed from the domain model (GLOSSARY.md). `Artifact` now only contains `metadata`.
- `artifact.files` is removed from Megaclaw's `RunResult` schema.
- Every external service that produces a deliverable must expose a **read HTTP route** consumed by the dashboard (and, for the agent, an equivalent MCP tool) — see ADR-013.
- The review page depends on seo-mcp's availability to display the article (no local cache).

> **Update (ADR-013):** the dashboard's reading of article content no longer goes through the `get_article_content` MCP tool but through a **REST HTTP route** of seo-mcp. The principle "content stays at the external service, Megaclaw stores a pointer" is unchanged; only the **channel** of access from Convex changes. See ADR-013 for the general rule.
