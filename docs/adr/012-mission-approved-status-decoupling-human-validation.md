# ADR-012: Mission `approved` status — decoupling human validation from GitHub publication

**Status:** Accepted

### Context

The SEO article publishing pipeline involves two distinct acts:

1. **Human validation** — the user reviews the article and the cover, and decides the content is ready.
2. **Publication** — the content is pushed to a GitHub repository, triggering a site rebuild.

The initial version of Megaclaw merged these two acts into a single click ("Approve") that called `publish_article` on seo-mcp directly. This merge prevented any future automation of publishing by an agent.

### Options considered

- **Merged**: a single click approves and publishes. Simple, but the "validated, not yet published" state doesn't exist in the model — an agent can't know which articles are ready to publish without querying seo-mcp.
- **Decoupled**: two separate steps, with an intermediate `approved` status on the Mission. The human validates; publication can be triggered by the human or, eventually, by an agent that scans `approved` missions.

### Decision

The `approved` status is added to the Mission state machine. The lifecycle becomes:

`todo` → `doing` → `to_validate` → **`approved`** → `done`

- `to_validate`: the Agent is waiting for a human decision (article to review).
- `approved`: the human has validated; publication pending (human or agent).
- `done`: article published on GitHub.

Two corresponding distinct Convex actions: `missions_node.approveArticle` and `missions_node.publishArticle`.

The canonical UI term for `approved` is **"To publish"** (analogy: "to deploy" column in Scrum).

### Consequences

- An agent can filter `approved` missions to trigger publication autonomously, without querying seo-mcp article by article.
- The review page is status-aware: it shows "Approve" at `to_validate` and "Publish" at `approved`.
- The mission list exposes both states (`to_validate` and `approved`) as entry points to the review page, with different CTA labels.
- The Convex schema and the `status` field validator must include `"approved"`.
- Statuses are not blocking — each mission type follows its own path to `done`. `approved` is only reached by missions that have a publication step (e.g. SEO articles); others go directly from `to_validate` to `done`.
- The `approved` state is Megaclaw-only — seo-mcp has its own `approved` on `seo_articles`; the two are synchronized via the `approve_article` / `publish_article` calls.
