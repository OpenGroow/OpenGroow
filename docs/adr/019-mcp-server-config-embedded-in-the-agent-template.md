# ADR-019: MCP server config embedded in the Agent Template, no central registry

**Status:** Accepted

### Context

Today, the concrete config of MCP servers (transport, URL, timeouts) lives in a **single Convex environment variable `MCP_SERVERS_CONFIG`** — a JSON blob `{ [serverName]: config }` grouping *all* servers. A Template's manifest only declares **names** (`mcpServers: string[]`); the config is resolved from this blob at activation (`resolveMcpServers`) and at missions (`missions_node.ts`).

The problem surfaced concretely (`Missing MCP server config for template video: demo-video-mcp` at activation: the server was missing from the blob), but the underlying issue is architectural:

1. **Not modular** — adding a server requires editing a large blob, and `convex env set` overwrites the entire value.
2. **Deployment coupling** — an env var (or a global versioned file) is frozen at deploy time.

The long-term vision: dynamically installable agents (Plugins living on GitHub, or a store), **without a restart**. The question: where should the MCP config live?

Note (cf. [ADR-017](017-storing-the-seo-mcp-apikey-in-the-agent-s-config.md)): the **per-project secret** (the `apiKey` used to call the MCP) already lives on the Agent (`projectAgents.config`), **not** in `MCP_SERVERS_CONFIG`. This blob only contains shared **endpoint metadata** — so no secret is at stake in this decision.

### Options considered

- **A — Central registry in the database.** A Convex `mcpServers` table (`name` → config), referenced by Templates via their `mcpServers: string[]`. Single source, mutable at runtime, servers shareable across Templates.
- **B — Config embedded in the Template.** The Template **carries** its MCP servers' config in its manifest, versioned with it. No central catalog; changing a server means publishing a new Template version.

### Decision

**B.** MCP server config is **embedded and versioned in the Agent Template**, inline in the manifest. `mcpServers` is enriched from `string[]` to objects:

```json
"mcpServers": [
  { "name": "seo-mcp", "transport": "streamable-http", "url": "…", "activationUrl": "…", "callTimeout": 600000 }
]
```

**Reasons:**

1. **Packaging consistency** — the Template is the unit that already groups its instructions, requirements, and available MCP tools (cf. `GLOSSARY.md`, ADR-008 (removed)). The MCP server is part of the agent's *contract*; it belongs to the same package, versioned with it.
2. **No false central concept** — a "global registry of shared MCP servers" doesn't describe the domain: a server changes *because* the agent changes. The right unit of versioning is the Template, not a table row.
3. **No secret to isolate** — since the `apiKey` lives on the Agent ([ADR-017](017-storing-the-seo-mcp-apikey-in-the-agent-s-config.md)), the manifest only carries non-sensitive metadata; nothing justifies a separate store.
4. **Live read, not a snapshot** — at mission time, the config is re-read from the Template (`getTemplate(templateId)`) — already done at activation (`resolveMcpServers`), so proven in a deployed Convex environment. The cost (reading bundled files) is negligible compared to the subsequent MCP network call (`callTimeout` in minutes). Nothing is frozen on the Agent.

### Consequences

- **The manifest schema changes**: `mcpServers: string[]` → typed objects. Update of `isValidManifest`, the type, `EMBEDDED_TEMPLATES`, and the `seo`/`video` manifests. Consumers (`resolveMcpServers`, `missions_node.ts`) read the config from the manifest.
- **`MCP_SERVERS_CONFIG` is removed** from runtime code. Tests that stubbed it now seed the config via the Template's manifest.
- **No central registry, no table**: no global "list all MCP servers." The list is the union of Templates' `mcpServers` — by design.
- **Per-environment origin deferred**: the URLs frozen in the manifest are the **local** values (`host.docker.internal`). The `host`/origin is the only field that runs into "versioned with the Template"; resolving it per environment (local/prod) is separate work, to be addressed before prod.
- **"No restart" is not delivered here**: Templates remain versioned files of the monorepo (ADR-008 (removed)) — adding/changing an agent remains a deployment. The runtime store (GitHub Plugins or DB) that will enable hot install is future work; this ADR keeps it compatible by keeping the config *with* the Template.
