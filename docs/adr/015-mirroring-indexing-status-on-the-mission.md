# ADR-015: Mirroring indexing status on the Mission

**Status:** Accepted

### Context

When an article is published (`POST /articles/:id/publish`), seo-mcp submits the article's public URL to an indexing provider (SpeedyIndex/Google) and returns the result in the response body: `indexing: { status: "submitted" | "error" | "skipped", … }`. Indexing is optional and **must never block publication** — an indexing failure leaves the article published.

Megaclaw wants to **make this state viewable**: show, on the mission, that indexing failed (without confusing it with a mission failure), persistently and non-blockingly.

However, `callSeoMcpPublishArticle` had until now ignored the response body, and Megaclaw's guiding principle (see `GLOSSARY.md`, _Artifact_) is that **external content and state live in the external service and are not duplicated**: an Artifact is a pointer, not a container.

### Options considered

- **Ephemeral toast** — `publishArticle` returns `indexing`, the UI shows a toast. Zero state duplication, but the info is lost as soon as the toast disappears: not viewable afterward.
- **`ArticleIndexingFailed` domain event** — stored alongside `ArticlePublished`. Consistent with the event pattern, but no UI surface reads these events today, and an indexing failure is not a first-class business fact (the article _is_ published).
- **Mirror on the Mission** — an `indexing` field (discriminated union) on the Mission aggregate, a verbatim reflection of the seo-mcp response.

### Decision

We **duplicate** the indexing state: an optional `indexing` field on `missions`, a **discriminated union** `submitted | error | skipped`, a **total and verbatim mirror** of the seo-mcp response (error message not reinterpreted), validated by zod before persistence.

The write is **folded into `markDone`** (atomic with the `done` transition). An indexing error **never fails the mission**: the mission stays `done`, `publishArticle` does not propagate the error. Rendering happens on the mission's **detail/review page** (badge derived from `mission.indexing`), not on the board.

### Consequences

- **Deliberate exception to the "no duplicated external state" principle**: indexing is copied onto the Mission to stay viewable offline, after the mission has left any active flow. The mirror is read-only on the megaclaw side and is never re-synchronized (snapshot at publication time).
- `indexing` distinct from `errorMessage`: disjoint semantics (**successful** mission vs. **failed** mission). Never reuse `errorMessage` to carry an indexing failure.
- Since the field is a union discriminated by `status`, adding a future provider or status is additive on the validator side.
- If an indexing failure becomes a first-class operational signal, the mirror can be promoted to a **domain event** (an option set aside here) without breaking the existing field.
