# ADR-013: seo-mcp integration boundary — agents via MCP tools, dashboard/Convex via HTTP routes

**Status:** Accepted (amends ADR-010; refines the scope of ADR-009)

### Context

seo-mcp exposes **two surfaces** for the same data:

- **MCP tools** (JSON-RPC over `/mcp`, e.g. `getOrCreateProject`, `get_article_content`);
- **REST HTTP routes** (e.g. `POST /projects`, `PATCH /projects/:id`, article content retrieval).

The same capability therefore often exists **on both sides**: creating a project = the `getOrCreateProject` tool *or* the `POST /projects` route. Without an explicit rule, it's unclear which channel to use from which code — and we've already had Convex calls parsing MCP JSON-RPC where a simple REST `fetch` would have sufficed.

### Decision

The channel used to access seo-mcp is determined by **the caller**, not by the capability:

- **The agent (OpenClaw runtime)** consumes seo-mcp **exclusively via MCP tools** (tool calling). This is the native LLM channel (ADR-009).
- **The dashboard and Convex actions** consume seo-mcp **exclusively via REST HTTP routes** (`fetch`). Never via MCP tool calling.

This distinction is **systematic**: even when an MCP tool and an HTTP route expose a similar capability, each caller stays on its own side. The two channels are never mixed within the same execution context.

### Reasons

1. **Each caller uses the tool suited to its context** — the agent speaks "LLM-native" (MCP); Convex application code speaks "server" (HTTP). The MCP channel (streamable-http, `initialize` handshake, JSON-RPC, `content[].text`) is needlessly heavy for a simple server call.
2. **Debuggability** — a REST route can be tested with `curl`, returns clear status codes (404, 401, 409), and requires no translation wrapper on the Convex side.
3. **Readability** — reading the code, the channel unambiguously indicates who is calling: `callMcpTool(...)` ⇒ agent; `fetch(\`${origin}/projects/...\`)` ⇒ dashboard/Convex.

### Consequences

- For every shared capability, seo-mcp must expose **both surfaces**: an MCP tool (for the agent) **and** an HTTP route (for the dashboard).
- **Credentials per channel**: the agent authenticates via its MCP headers/JWT; Convex uses `Authorization: Bearer <apiKey>` on the HTTP routes.
- **The format can differ between the two channels** — a REST route's body follows its own schema (e.g. `publisher: { type: "github", ... }` flattened) which is not necessarily the same as the equivalent MCP tool's. **Always validate the format on the HTTP route side** when calling from Convex, without assuming it's identical to the MCP tool.
- **Amends ADR-010**: the dashboard read path now goes through REST, not the MCP tool (ADR-010's body has been updated accordingly).
- **Refines ADR-009**: "external services consumed by agents are over MCP" remains true, but only applies **to agents** — not the dashboard, which speaks HTTP.
