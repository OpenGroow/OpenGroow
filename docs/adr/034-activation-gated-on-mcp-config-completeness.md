# ADR-034: Activation gated on MCP Config Completeness — `statusCheck` contract replaces Activation/Reconfiguration for MCP-owned Project config

**Status:** Accepted (amends [ADR-021](021-declarative-activation-reconfiguration-contract.md); related to [ADR-019](019-mcp-server-config-embedded-in-the-agent-template.md) and [ADR-020](020-artifact-review-and-external-job-contracts-carried.md))

### Context

seo-mcp and demo-video-mcp are each migrating their per-Project configuration (GitHub publisher, Postiz channels, Letter-server credentials, model overrides…) out of Megaclaw and into their own dashboards. Once that lands, a human creates the Project directly on the MCP's dashboard and gets a **Project API Key** scoped to it — that key is the only thing Megaclaw still needs to activate the SEO Agent or Video Agent.

Before this ADR, activating either Agent still meant filling in every provider field by hand in Megaclaw's activation form, which the manifest's `activation`/`reconfiguration` HTTP effects (ADR-021) then pushed to the MCP. Once the MCP owns that config, this form is redundant and actively wrong: it lets a human create an Agent in Megaclaw whose Project might not be configured at all on the MCP's side, since the MCP can no longer be told about the config through Megaclaw — completing it is now exclusively a human action in the MCP's own dashboard. An Agent activated this way looked `active` in Megaclaw but was silently guaranteed to fail on its first real Mission.

### Decision

Activation for the SEO and Video Templates is reduced to a single `apiKey` requirement, and Activation is made conditional on the MCP reporting the Project fully configured — closing the gap instead of discovering it mid-Mission.

1. `requirements[]` in both `packages/agent-templates/templates/seo/manifest.json` and `.../video/manifest.json` shrinks to the single `apiKey` field. Every other requirement (domain, language, country, context, articleBasePath, github\*, indexerApiKey, postiz\*, siteBaseUrl, defaultFormat, letterBaseUrl/Token) is removed — that configuration now lives exclusively in the MCP's own dashboard.
2. The declarative HTTP `activation`/`reconfiguration` effects (ADR-021) are removed from both manifests. Activation instead declares a **`statusCheck` contract**: `{ server, mcpTool }`, using the same "call an MCP tool from Convex" mechanism already used for External Job polling (`externalJobsByMissionType[...].mcpTool`, ADR-020/026), authenticated with the stored `apiKey`.
3. This status-check calls the MCP's read-only Project-status tool (`get_project_status` for both — the same tool name, since the contract is generic and MCP-owned) and expects a generic response contract: `{ configured: boolean, dashboardUrl: string, message?: string }`.
4. The Agent only reaches `active` when `configured === true`. If the key is rejected by the MCP, or the key is valid but `configured === false`, the Agent is left in the existing `error` status with a distinct, human-readable `errorMessage` for each case. `projectAgents` gains an optional `errorLink` field to carry `dashboardUrl` so the UI can render it as a real link instead of parsing it out of free text.
5. The existing "Retry" action on an `error` Agent re-runs only the status-check call — it does not ask for the key again, since the key was already accepted by the MCP the first time (unless the error was specifically "key rejected", in which case the user must re-open the activation form to enter a corrected key). Megaclaw distinguishes the two cases from data, not a dedicated flag: `config.apiKey` is only ever persisted once the MCP has accepted the key (i.e. the call didn't throw) — its absence on an errored Agent means the key itself was rejected.
6. There is no automatic re-verification once an Agent is `active`: no recheck before Mission creation, no periodic recheck. A Project broken *after* activation by editing it in the MCP's dashboard is out of scope.
7. The "Edit config" action disappears for these two Templates — with `apiKey` as the only, immutable requirement, there is nothing left to reconfigure (this falls directly out of the existing `hasEditableRequirements` derivation, no new UI branch needed). To rotate the key, the user deactivates and reactivates the Agent with a new key (mirroring the MCP dashboards' own "revoke and regenerate" flow) — reactivation always re-runs the status-check with the newly submitted key, since there is no "already provisioned, skip" guard on a `statusCheck` contract (unlike ADR-021's derived-id skip for HTTP activation effects).
8. This mechanism is built generically (declarative in the manifest + interpreted by a generic engine, no seo/video-specific branch in Convex) so any future Template whose MCP owns its Project config end-to-end can reuse it without new Convex code.

### Implementation notes

- `validateManifest` (`packages/agent-templates/src/index.ts`) gains a `statusCheck` validator (server + mcpTool, cross-checked against `mcpServers` the same way `externalJobsByMissionType` entries are) and continues to treat `activation`/`reconfiguration` as fully optional — nothing requires them to be present.
- The status-check contract is fixed and MCP-owned: `configured: boolean`, `dashboardUrl: string`, `message?: string` (only meaningful when `configured` is false). Megaclaw never derives its own message from per-provider field names — that would reintroduce per-service knowledge into Convex.
- `apps/convex/project_agents/status_check.ts` (`checkConfigCompleteness`) is the generic executor: resolves the MCP server URL from the Template manifest, calls the tool via the existing `callMcpTool` (`apps/convex/mcp_node.ts`) with the apiKey as a Bearer header, and classifies the outcome (`configured` / `not_configured` / `key_rejected`) — no seo/video-specific code.
- `apps/convex/project_agents_node.ts`: `activateProjectAgent` branches on `manifest.statusCheck` before the `activation` effect branch; a new `retryProjectAgentStatusCheck` action re-runs only the check using the Agent's stored `config.apiKey`.
- `apps/dashboard/src/components/instance-agents-page.tsx` renders `errorLink` as a clickable link in the existing inline error banner, and routes the "Retry" button to the new status-check-only action when the Agent already has a stored `apiKey` (falling back to reopening the activation form otherwise).
- Existing pre-migration SEO/Video Agents carry now-dead config fields in their persisted `config` (domain, githubToken, postizChannelId…) — these are left unread rather than migrated, consistent with ADR-021's own "one-off migration, then strict code" precedent for the earlier flattening; a follow-up cleanup can drop them once this ships.
- `buildRuntimeContext` for `seo`/`video` (`packages/agent-templates/src/index.ts`) still reads `agentConfig.seoProjectId`/`videoProjectId`, and the Templates' instructions still document those fields as part of the runtime context — deliberately left untouched here. Those ids were only ever populated by the now-removed `activation` HTTP effect; once seo-mcp/demo-video-mcp resolve a Project from the `apiKey` alone (their own migration, tracked in their own repositories), the runtime context and tool contracts will need a follow-up pass. Doing that here would mean guessing at an MCP-side contract that doesn't exist yet.

### Out of Scope

- The `get_project_status` MCP tool implementations themselves — tracked in the linked follow-up issues on `seo-mcp` and `demo-video-mcp`.
- Any recheck of Config Completeness after a successful activation (before Mission creation, or on a schedule).
- Data migration of existing Agents' now-dead config fields.
- Any change to Templates other than SEO and Video.
