# ADR-080: OpenGroow serves an internal MCP from Convex

**Status:** Proposed

## Context

Every MCP server an Agent calls today is external: the Template declares it (ADR-019) and the service runs elsewhere. A Strategy Agent needs to read OpenGroow's own data: analytics, Publications, Missions, the Brand Core. The Agent cannot call Convex: it has no signing key and no tool for it, and ADR-052 settled that the Agent reports and Convex writes. The question is how an Agent reads Convex data.

## Decision

- **Convex serves the MCP protocol itself**, on an HTTP action (`streamable-http`): `initialize`, `tools/list`, `tools/call`. A Template declares it in `mcpServers` with Convex's URL, like any other server, and lists the tools it is allowed to call.
- **One server, a catalog of tools.** Each Template declares the tools it may call. Convex exposes only those to a Run and **checks again in `tools/call`**, not only in `tools/list`.
- **Authentication is an Agent token; reading data only works during a Run.** Convex generates it at activation and stores it as the Agent's `apiKey` (ADR-017), so the existing activation path (ADR-021) writes it as the server's `Authorization` header in the runtime config. The runtime configures MCP servers once per Instance, at activation, not per Run: a token injected per Run would need a config rewrite at each launch, shared by concurrent Runs. So the token is stable and the **time limit is enforced by Convex**: on every call it verifies the token, then that the Agent has a Run in `running` (`by_instance_template_status`), then the tool against the Template's declaration, with the Agent's Project as the only scope. Outside a Run the token is refused. It is never in the Agent's context (ADR-017).
- **Read-only in V1.** The tools are `get_analytics_summary`, `list_publications`, `list_missions`, `get_brand_core` and `list_mission_types`. Nothing writes through it: what an Agent wants to change goes in its result file, which Convex validates (ADR-052).
- **Other Agents may use it later** by declaring the tools they need. This ADR does not add any.

## Considered options

- **A separate MCP service in the monorepo, calling Convex over HMAC.** Rejected: one more service to deploy and run, including in self-host (ADR-028, ADR-033), for no gain.
- **HMAC routes the Agent calls directly, like the Mission summary route.** Rejected: the Agent has no key for it, and ADR-052 removed the Source route for the same reason. It would also be a bespoke contract per route where MCP already is the contract Agents use.
- **A token issued per Run and injected into the server's headers at launch.** Rejected: the runtime holds one MCP config per Instance, written at activation, so per-Run headers would mean rewriting it at each launch while other Runs read it. The liveness check in Convex gives the same limit without touching the runtime.

## Consequences

- The first MCP server implemented in the monorepo: a protocol handler on an HTTP action in the default runtime (`fetch` needs no `"use node"`; a Node action cannot sit in a file with queries or mutations), or the MCP SDK in a separate Node file. To be chosen when building it.
- **The Template cannot know the URL.** It is Convex's HTTP address (the site proxy, port 3211 in self-host, the `.convex.site` domain in the cloud). OpenGroow must derive it, as it does for operator URL overrides (`mcp_url_override.ts`), instead of reading it from the manifest.
- **OpenClaw's SSRF guard decides which form of URL works.** It refuses a server whose hostname resolves to a private address, so `convex-backend:3211` (Docker network name) cannot be used. The Gateway already rewrites `http://host.docker.internal:<port>` and `localhost` to `127.0.0.1:<port>` and relays that port to the host (`control-socket-mcp-loopback.js`), which works when Convex's site port is published on the host. A public `https://….convex.site` address resolves to a public IP and passes the guard.
- **Per deployment.** In `pnpm dev` and `pnpm start`, Convex's site port is published on the host (`CONVEX_SITE_PROXY_PORT`, 3211 by default) and the Instances run on the same host Docker daemon, so the Gateway reaches it through `host.docker.internal` and its relay, as it does for the other local MCP servers. The URL is therefore derived from that configured port, never hardcoded. A self-host server that publishes Convex under a public HTTPS name also passes the guard; a private internal name does not. **Not verified:** where the runtimes of the hosted offer run, and whether they reach Convex's public site address. This must be confirmed on that deployment before the Strategy Agent ships there.
- **Checked with OpenClaw 2026.9.1** (the version running in the local gateway), in a throwaway HOME so no Instance config was touched: a stateless server answering plain `application/json` (no session id, no SSE) was initialized and listed by `openclaw mcp probe` with a static `Authorization` header, and a wrong token surfaced as a probe failure. The client also opens a `GET` for a server stream after `initialized`; answering it `405` is accepted. So a Convex HTTP action can serve MCP without a session store.
- OpenClaw prefixes tool names with the server name (`internal__list_missions`) and says tools without safety annotations "require approval in prompting session postures". The tools must declare `readOnlyHint: true`.
- The activation header patch (`mergeRuntimeMcpServers`) applies the Agent's `apiKey` to **every** server the Template declares. A Template that uses the internal MCP must declare no other server until that patch becomes per server.
- The token is long-lived and the liveness check is the only limit: a leaked token gives read access to one Project's data while one of that Agent's Runs is `running`. It cannot write. Rotating it goes through Deactivation and Reactivation (ADR-017).
