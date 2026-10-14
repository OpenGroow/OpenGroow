# ADR-020: Artifact, review, and External Job contracts carried by Agent Templates

**Status:** Accepted (amends ADR-010)

### Context

Megaclaw's first review flow was the SEO article: the Agent wrote a `RunResult` with `artifact.metadata.articleId`, then the review page called specific Convex actions (`getArticleContent`, `approveArticle`, `publishArticle`). The arrival of the video Template showed that this contract was too specific: a video does not produce an `articleId`, but a reference to an external render, and its validation/publication actions are different.

The problem isn't limited to video. If every new Template forces a `templateId` branch in Convex or the dashboard, Megaclaw does not have a real plugin model: deliverable business logic remains hardcoded in the application core instead of being carried by the Template.

### Decision

The Template carries the integration contracts for the deliverables it produces:

- **Generic Artifact**: an Artifact is a structured pointer to an external deliverable, conceptually shaped as `{ kind, external, metadata }`. `external` indicates the responsible service and the deliverable's identifier within that service. The service references a server declared by the same Template; the Artifact carries no environment URL. Legacy fields like `articleId` or the video render identifier are Template integration details, not the common contract.
- `metadata` remains available for display and context, but never carries the deliverable's identity and must not be required to resolve its content.
- **Declarative review**: the Template declares the deliverable type, the content to present, and the available business actions (`approve`, `reject`, `publish`, etc.). Convex executes these actions via a generic engine; adding a Template must not require adding a specific business handler in Convex.
- **Generic renderer**: the dashboard uses a generic rendering driven by `review.content`. Content types are bounded (`metadata`, `markdown`, `image`, `video`, then explicit extensions if needed). The Template does not reference a specific React component.
- **Loading via Convex**: the UI does not read the external service directly. It asks Megaclaw for the review content, which checks ownership, resolves the Template and the Artifact, executes the declared read effect, then returns a safe representation for the generic renderer.
- **Bounded external effects**: review actions and External Job polls use a small declarative HTTP effect language: server declared in `mcpServers`, method, path/body interpolated from controlled references, response mapping. The Template contains no arbitrary application code.
- **Inputs and generic relaunch**: a review action can declare the required user inputs. Rejecting a deliverable is modeled as a generic Mission relaunch with human feedback (`revisionRun`), not as a Template-specific handler.
- **Canonical capabilities**: common business actions are `approve`, `reject`, and `publish`. They are optional and their UI label is configurable. `publish` only exists for deliverables with a distinct publication step; otherwise `approve` can lead directly to `done`.
- **Generic External Jobs**: for long-running processing, the Agent does not poll itself. It launches the external work, writes a non-terminal handoff with the job type and its external reference, then stops. Megaclaw polls the external service according to the Template's contract and turns the terminal state into a final RunResult, Mission status, and possible Artifact.

ADR-010 remains true in principle — "content stays in the external service; Megaclaw stores a pointer." It is amended in form: this pointer is no longer `artifact.metadata.articleId` as a durable contract, but a generic Artifact.

### Reasons

1. **Real pluginability** — the Convex core and the dashboard interpret a Template contract instead of accumulating branches per Template.
2. **Stability of long Runs** — an Agent does not stay alive solely to wait for a long render or generation. Megaclaw owns the polling loop, retries, and state transition.
3. **Clear boundary** — the Template describes the integration; Convex keeps cross-cutting responsibilities: ownership, Mission loading, Template resolution, bounded HTTP execution, state transitions.
4. **Security and maintainability** — the manifest remains declarative. We avoid executing arbitrary plugin code in Convex while still letting Templates define their external effects.

### Consequences

- The `RunResult` schema will need to evolve to carry the generic Artifact. The External Job's non-terminal handoff will need to be formalized separately from the terminal RunResult.
- The `seo` and `video` manifests will need to declare their review contract, their HTTP effects, and, for video, its External Job contract.
- The specific Convex actions (`approveArticle`, `validateVideo`, etc.) are not the durable target. They must be replaced by a generic review/external job engine grounded in the Template.
- External Job tracking must be separated from the Agent dispatch loop: one loop launches Runs in OpenClaw, another polls external jobs already handed back to Megaclaw.
- The UI uses a generic renderer driven by the Template's `review.content` contract. Article/video variations are content configurations, not dedicated components per Template.
- The legacy `metadata.articleId` and `metadata.runId` formats must be converted by a one-off migration. The target application code must then be strict about the new contract, without lasting runtime compat.
