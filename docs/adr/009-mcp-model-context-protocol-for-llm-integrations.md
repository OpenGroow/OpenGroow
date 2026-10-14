# ADR-009: MCP (Model Context Protocol) for LLM integrations

**Status:** Accepted

### Context

SEO agents (and future agents) need to call external services (crawling, article generation, keyword research). These services can be exposed as classic REST APIs or via MCP.

### Decision

External services consumed by agents are exposed via **MCP servers** (e.g. `seo-mcp`).

**Main reason:**

MCP is native for LLMs: Claude Code calls MCP tools directly via **structured tool calling**, without a translation wrapper between REST API and `tool_use` format. The interface is the same as built-in tools — agents don't have to learn a different calling convention.

**Secondary advantages:**

- MCP servers can be stateful (PostgreSQL) and multi-tenant — each session is scoped to a project via a signed JWT.
- MCP errors (blocked tool, missing snapshot) surface structurally in the `warnings` and can be handled by the agent via the escalation rules defined in `AGENTS.md`.

### Consequences

- Each new integration type requires an MCP server (or integrating into an existing one) — slightly heavier than a simple HTTP client for simple needs.
- MCP servers are services to maintain separately from the Megaclaw monorepo.
- The `AGENTS.md` format must document the ordered pipeline of available MCP tools (the agent should not have to guess the calling order).
