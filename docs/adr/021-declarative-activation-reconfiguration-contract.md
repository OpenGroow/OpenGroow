# ADR-021: Declarative Activation/Reconfiguration contract

**Status:** Accepted (amends ADR-008 (removed); related to [ADR-019](019-mcp-server-config-embedded-in-the-agent-template.md) and [ADR-020](020-artifact-review-and-external-job-contracts-carried.md))

> **Amended by [ADR-034](034-activation-gated-on-mcp-config-completeness.md).** For Templates whose MCP has migrated its per-Project configuration to its own dashboard (seo-mcp, demo-video-mcp), the declarative HTTP `activation`/`reconfiguration` effects described below are replaced by a `statusCheck` MCP tool call — Megaclaw only provisions the `apiKey`, and gates Activation on the MCP itself reporting the Project as fully configured. This ADR's contract remains valid and in use for any Template that still provisions its resource via a POST/PATCH HTTP effect.

### Context

An Agent's **Activation** (creating the project at the external service, retrieving its frozen identity, remembering the config) and its **Reconfiguration** (modifying the config of an already active Agent) were written **by hand in TypeScript** in each Template (`activate`/`reconfigure` for seo and video). Convex and the `agent-templates` package therefore carried per-service knowledge: seo-mcp vs demo-video-mcp request body, frozen-id response field (`seoProjectId` vs `project.id`), identity field names in the persisted config. A re-activation guard was even hardcoded on `seoProjectId` in Convex.

The skeleton is thin (`validate userConfig → build the body → POST /projects (409 = already exists = ok) → return the persisted config`) but the per-service deltas are real. A *shared helper* (the skeleton + 3 callbacks) would be the classic superficial abstraction (the "wrong abstraction"). The deep move is a **declarative activation effect** in the manifest, interpreted by the same bounded-effect machinery as `performReviewAction` (ADR-020). It's the logical continuation of ADR-019 (MCP servers in the Template) and ADR-020 (review/External Job declared by the Template).

### Decision

Activation and Reconfiguration are declared **as data** in the Template's `manifest.json` and executed by a **generic interpreter**; Convex/the engine no longer contains any seo/video-specific branch.

The contract:

1. **Body language: JSON tree.** The request body is a tree of literals and `{reference}` leaves. Allowed references: `{<userConfig key>}`, `{config.<key>}` (persisted config, e.g. the frozen id), and `{responseId}` (extracted from the activation response). Omission rule: a leaf whose reference resolves empty is omitted; an object where **all** interpolated leaves resolve empty is omitted (literals like `type: "github"` don't count as content). This language generalizes the flat `Record<string,string>` body of review effects into a nested tree — review effects remain valid as flat trees.

2. **Activation and Reconfiguration share the same shape**, differing only in: `method` (POST vs PATCH), `path` (reconfigure interpolates the frozen id: `/projects/{config.seoProjectId}`), and the **emptiness rule** — on POST an empty optional block is *omitted*; on PATCH, clearing a nested block (e.g. the SEO indexer) requires sending `null` (omitting it would leave the old value). This is the only POST/PATCH divergence encoded. The form always submits **all** reconfigurable fields (pre-filled), so the "partial"/tri-state semantics of the old code were a defensive artifact, not a requirement.

3. **Frozen identity extracted from the response** via `responseIdField` as a **dotted path** (`"seoProjectId"` for seo, `"project.id"` for video). The persisted-config tree places `{responseId}` under the desired key (`seoProjectId`/`videoProjectId`); the reconfigure `path` refers to this same key. The id key therefore does not need to be declared separately.

4. **409 = existing**: `treatConflictAsExisting` flag. On a 409 (the project already exists at the service), we still parse the body and extract `{responseId}`.

5. **Generic "already provisioned" guard**: the engine skips the activation effect when the key carrying `{responseId}` is already present in the existing config — derived from the tree, **no hardcoded name** (fixes the asymmetry where only `seoProjectId` was checked, never `videoProjectId`).

6. **Flat persisted config**: we store exactly the form fields + the frozen id, **without re-nesting**. Megaclaw only ever reads the frozen id and the `apiKey` anyway; the nested blocks (`publisher`/`letter`/`indexer`) only served to re-populate the edit form via `buildEditInitialValues`, which disappears. The nested body only exists on the wire, built at call time.

7. **Bounded HTTP primitive shared** with `performReviewAction`: `executeBoundedHttpEffect(effect, refContext)` (resolves server+origin, interpolates path/body, fetch+timeout, extracts the response). Review and activation each call it with their own reference context and their own pre/post steps (Mission transition vs config persistence + MCP merge). No merged entry point: the lifecycles remain distinct.

### Options considered

- **Shared helper (3 callbacks).** Common skeleton + per-service callbacks. Rejected: superficial abstraction that leaves per-service knowledge in the code.
- **Full transformation DSL** (conditions, computed sub-blocks in the manifest). Rejected: rebuilds `buildSeoPublisher` in untyped/untestable JSON — the "wrong abstraction" in disguise.
- **Code seam for reconfigure only.** Rejected: we showed that the form always submits the complete set, so PATCH is expressible as data just like activation; keeping code would leave the engine half-generic.

### Consequences

- `mcpConfigPatches` is **removed** from the contract: the `Authorization: Bearer <apiKey>` auth header is already generically reapplied at every activation from the config's `apiKey` (not just the first). The activation effect no longer returns an MCP patch.
- `validateManifest` must enforce the new contract (referenced server present in `mcpServers`; `method ∈ {POST, PATCH}`; interpolation references pointing to `requirements`/`{id}`/`{responseId}`/`config.*` keys; `responseIdField` present). Valid/invalid shapes covered by tests.
- **One-off migration** of existing Agents' configs (nested shape → flat): without it, editing a pre-migration agent would reload an empty form and a save would wipe its config on the service side. Consistent with ADR-020's "one-off migration then strict code" strategy.
- `buildRuntimeContext` remains out of scope: it stays per-Template code (reads the frozen id to inject it into the Run context).
- The TypeScript `activate`/`reconfigure` functions and `buildEditInitialValues` are removed once the engine is in place.
