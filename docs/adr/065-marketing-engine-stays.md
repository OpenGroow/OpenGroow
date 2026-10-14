# ADR-065: The marketing engine stays in the product

**Status:** Accepted. Supersedes the "decide later" note of #710 and the provisional "do-not-carry" verdict of `docs/CUT-DOC-REVIEW.md` for ADR-044 to ADR-049. Does not rewrite those ADRs.

## Context

The product is a generic layer (UI plus an integration standard on top of OpenClaw), and marketing is its first domain of use (`GLOSSARY.md`). The Convex backend holds a marketing-specific engine: `observations_*`, `score_jobs`, `ranking_jobs`, `source_enrichment`, `indexing`, described by ADR-044 to ADR-049 and reshaped by ADR-051 and ADR-052 (Sources, Source agent). #710 left open whether it stays in the product or leaves with the cloud.

## Decision

- **It stays in the OpenGroow product repository.** It is not part of the cloud: self-host users run it the same way as hosted ones, and the cloud only reaches the product through the signed control API (ADR-061).
- ADR-044 to ADR-049 are carried to the new repository as frozen history. Where a later ADR retired part of them (Insights by ADR-048, Observations folded into Sources by ADR-051), the later ADR wins.
- References to private services in this engine (`enrich-mcp` in ADR-047 and its code, `seo-mcp`, `typesafe`, `demo-video`…) are to be neutralized: the engine must work with the user's own MCP. That follows the criterion used for the public hub: could someone else run it with their own MCP?

## Consequences

- No extraction work for this engine in the cut.
- Neutralizing the private-service references in product code is a follow-up (no issue yet).
