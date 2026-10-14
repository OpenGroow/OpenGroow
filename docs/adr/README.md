# Architecture Decision Records

One file per decision, named `NNN-slug.md`. Each file starts with its title and a `Status` line: context, options considered, decision, consequences.

ADRs are frozen: add a new one, do not rewrite an old one. The "Live?" column below is an index annotation (audit of 2026-10-12 against the code), not part of the ADRs themselves: read it before relying on an older decision.

Numbers 010, 015, 016 and 033 each appear twice (pre-existing collision); refer to them by file name. ADR-005 and ADR-031 moved to the cloud repository, ADR-008 was deleted, as were 030 and 044 to 049 (obsolete: superseded by 033 and 051).

| ADR | Decision | Status | Live? | File |
| --- | --- | --- | --- | --- |
| 001 | Convex as the primary backend | Accepted | yes | [001-convex-as-the-primary-backend.md](001-convex-as-the-primary-backend.md) |
| 002 | Multi-tenancy via Convex Auth ownership | Accepted | Uses Better Auth, not Convex Auth; ownership principle holds | [002-multi-tenancy-via-convex-auth-ownership.md](002-multi-tenancy-via-convex-auth-ownership.md) |
| 003 | Command retry with exponential backoff via Convex Scheduler | Accepted | yes | [003-command-retry-with-exponential-backoff-via-convex.md](003-command-retry-with-exponential-backoff-via-convex.md) |
| 004 | Hono + WebSocket Broker as the OpenClaw gateway | Accepted | yes | [004-hono-websocket-broker-as-the-openclaw-gateway.md](004-hono-websocket-broker-as-the-openclaw-gateway.md) |
| 006 | openclaw-connect as a separate service | Accepted | yes | [006-openclaw-connect-as-a-separate-service.md](006-openclaw-connect-as-a-separate-service.md) |
| 007 | HMAC for inter-service authentication | Accepted | OPENCLAW_CONTROL_KEYS only exists on the control plane side | [007-hmac-for-inter-service-authentication.md](007-hmac-for-inter-service-authentication.md) |
| 009 | MCP (Model Context Protocol) for LLM integrations | Accepted | yes | [009-mcp-model-context-protocol-for-llm-integrations.md](009-mcp-model-context-protocol-for-llm-integrations.md) |
| 010 | Deliverable content stays in the external service — Megaclaw stores a pointer | Accepted | yes | [010-deliverable-content-stays-in-the-external-service.md](010-deliverable-content-stays-in-the-external-service.md) |
| 010 | Next.js 15 with App Router for the dashboard | Accepted | Next.js is now 16 (title says 15) | [010-next-js-15-with-app-router-for-the-dashboard.md](010-next-js-15-with-app-router-for-the-dashboard.md) |
| 011 | Turborepo + pnpm workspaces | Accepted | yes | [011-turborepo-pnpm-workspaces.md](011-turborepo-pnpm-workspaces.md) |
| 012 | Mission `approved` status — decoupling human validation from GitHub publication | Accepted | Actions renamed: transitions are manifest-driven now | [012-mission-approved-status-decoupling-human-validation.md](012-mission-approved-status-decoupling-human-validation.md) |
| 013 | seo-mcp integration boundary — agents via MCP tools, dashboard/Convex via HTTP routes | Accepted | yes | [013-seo-mcp-integration-boundary-agents-via-mcp-tools.md](013-seo-mcp-integration-boundary-agents-via-mcp-tools.md) |
| 014 | Sequential Mission number per Project | Accepted | yes | [014-sequential-mission-number-per-project.md](014-sequential-mission-number-per-project.md) |
| 015 | Mirroring indexing status on the Mission | Accepted | Function names outdated; principle holds | [015-mirroring-indexing-status-on-the-mission.md](015-mirroring-indexing-status-on-the-mission.md) |
| 015 | Mission `summary` written by the Agent through a dedicated write channel (summary-only) | Accepted | yes | [015-mission-summary-written-by-the-agent.md](015-mission-summary-written-by-the-agent.md) |
| 016 | Mission deletion — hard delete rather than archiving | Accepted | yes | [016-mission-deletion-hard-delete-rather-than-archiving.md](016-mission-deletion-hard-delete-rather-than-archiving.md) |
| 016 | UI language — all English | Accepted | yes | [016-ui-language-all-english.md](016-ui-language-all-english.md) |
| 017 | Storing the seo-mcp apiKey in the Agent's config | Accepted | yes | [017-storing-the-seo-mcp-apikey-in-the-agent-s-config.md](017-storing-the-seo-mcp-apikey-in-the-agent-s-config.md) |
| 018 | Delivering the Brand Core via Run context, not a persistent memory file | Accepted | yes | [018-delivering-the-brand-core-via-run-context.md](018-delivering-the-brand-core-via-run-context.md) |
| 019 | MCP server config embedded in the Agent Template, no central registry | Accepted | yes | [019-mcp-server-config-embedded-in-the-agent-template.md](019-mcp-server-config-embedded-in-the-agent-template.md) |
| 020 | Artifact, review, and External Job contracts carried by Agent Templates | Accepted | yes | [020-artifact-review-and-external-job-contracts-carried.md](020-artifact-review-and-external-job-contracts-carried.md) |
| 021 | Declarative Activation/Reconfiguration contract | Accepted | yes | [021-declarative-activation-reconfiguration-contract.md](021-declarative-activation-reconfiguration-contract.md) |
| 022 | Android Plugin — a single CLI with app profiles | Accepted | yes | [022-android-plugin-a-single-cli-with-app-profiles.md](022-android-plugin-a-single-cli-with-app-profiles.md) |
| 023 | Autonomous comments without human approval in the Social Engagement agent | Accepted | yes | [023-autonomous-comments-without-human-approval.md](023-autonomous-comments-without-human-approval.md) |
| 024 | Pinterest publishing via extending the Video Agent Template, not a separate Template | Accepted | yes | [024-pinterest-publishing-via-extending-the-video-agent.md](024-pinterest-publishing-via-extending-the-video-agent.md) |
| 025 | Logs and Usage — two separate mechanisms, not persisted, without exposing `sessionKey` | Accepted | Routes moved under settings/ | [025-logs-and-usage-two-separate-mechanisms-not-persisted.md](025-logs-and-usage-two-separate-mechanisms-not-persisted.md) |
| 026 | Intermediate External Jobs resume the Mission instead of always producing a terminal RunResult | Accepted | yes | [026-intermediate-external-jobs-resume-the-mission-instead.md](026-intermediate-external-jobs-resume-the-mission-instead.md) |
| 027 | Documentation prose migrates from French to English — big-bang, docs only | Accepted | Migration done | [027-documentation-prose-migrates-from-french-to-english.md](027-documentation-prose-migrates-from-french-to-english.md) |
| 028 | `InstanceProvisioner` seam for OSS single-Project self-hosting | Accepted | Seam still exists; the Hetzner/OSS-export parts are gone (see 061) | [028-instanceprovisioner-seam-for-oss-single-project-self.md](028-instanceprovisioner-seam-for-oss-single-project-self.md) |
| 029 | Self-host authentication — email/password with auto-lock after first account | Accepted | Google OAuth and landing parts superseded by 059 and 062 | [029-self-host-authentication-email-password-with-auto-lock.md](029-self-host-authentication-email-password-with-auto-lock.md) |
| 032 | Reconciliation's last-chance salvage read tracked via a dedicated command id, not a boolean flag | Accepted | yes | [032-reconciliation-s-last-chance-salvage-read-tracked.md](032-reconciliation-s-last-chance-salvage-read-tracked.md) |
| 033 | Local-multi is the only self-host provisioning model; single-Project infrastructure removed | Accepted | yes | [033-local-multi-is-the-only-self-host-provisioning-model.md](033-local-multi-is-the-only-self-host-provisioning-model.md) |
| 033 | Shared bounded-retry primitive across Run/Node/External-Job reliability logic, no unified state machine | Accepted | yes | [033-shared-bounded-retry-primitive-across-run-node.md](033-shared-bounded-retry-primitive-across-run-node.md) |
| 034 | Activation gated on MCP Config Completeness — `statusCheck` contract replaces Activation/Reconfiguration for MCP-owned Project config | Accepted | yes | [034-activation-gated-on-mcp-config-completeness.md](034-activation-gated-on-mcp-config-completeness.md) |
| 035 | Verify and select the Instagram account inside the Android Plugin | Accepted | yes | [035-verify-and-select-the-instagram-account-inside.md](035-verify-and-select-the-instagram-account-inside.md) |
| 036 | Serialize Runs that share an Execution device | Accepted | Mechanism is now generic exclusiveResources (#656) | [036-serialize-runs-that-share-an-execution-device.md](036-serialize-runs-that-share-an-execution-device.md) |
| 037 | Agent Templates declare their blockers through one generic contract | Accepted | yes | [037-agent-templates-declare-their-blockers-through-one.md](037-agent-templates-declare-their-blockers-through-one.md) |
| 038 | Review contracts are explicit for every reviewable Mission type | Accepted | yes | [038-review-contracts-are-explicit-for-every-reviewable.md](038-review-contracts-are-explicit-for-every-reviewable.md) |
| 039 | Marketing Mocks are illustrative, not faithful product simulations | Accepted | yes | [039-marketing-mocks-are-illustrative-not-faithful-product.md](039-marketing-mocks-are-illustrative-not-faithful-product.md) |
| 040 | Forum Engagement uses the OpenClaw browser (CDP), not the Android Plugin | Accepted | yes | [040-forum-engagement-uses-the-openclaw-browser-cdp.md](040-forum-engagement-uses-the-openclaw-browser-cdp.md) |
| 041 | forum-mcp enforces the Link Drop gate structurally, not the Agent's judgment | Accepted | yes | [041-forum-mcp-enforces-the-link-drop-gate-structurally.md](041-forum-mcp-enforces-the-link-drop-gate-structurally.md) |
| 042 | Adding TikTok to Social Engagement requires generalizing the Android Plugin engine first | Accepted | yes | [042-adding-tiktok-to-social-engagement-requires.md](042-adding-tiktok-to-social-engagement-requires.md) |
| 043 | A SERP genuinely dominated by an unrelated entity is a terminal success, not a failure — and permanently excludes the Keyword | Accepted | yes | [043-a-serp-genuinely-dominated-by-an-unrelated-entity.md](043-a-serp-genuinely-dominated-by-an-unrelated-entity.md) |
| 050 | Run-level prompt snapshot for debugging — a read-only exception to ADR-018's no-persistence rule | Accepted | yes | [050-run-level-prompt-snapshot-for-debugging-a-read-only.md](050-run-level-prompt-snapshot-for-debugging-a-read-only.md) |
| 051 | Sources — a generic, manifest-declared contract replaces Observation; a SourceJob (not a Mission) normalizes and enriches | Accepted | yes | [051-sources-a-generic-manifest-declared-contract-replaces.md](051-sources-a-generic-manifest-declared-contract-replaces.md) |
| 052 | A generic `source` Agent owns scoring and routing; SourceJobs ingest from Run result files | Accepted | Partly superseded: scoring/routing mission types retired; SourceJob moved to generic Job (#601) | [052-a-generic-source-agent-owns-scoring-and-routing.md](052-a-generic-source-agent-owns-scoring-and-routing.md) |
| 053 | Hidden Mission types — an Agent-level deny-list of Mission types, chosen in Megaclaw | Accepted | yes | [053-hidden-mission-types-an-agent-level-deny-list.md](053-hidden-mission-types-an-agent-level-deny-list.md) |
| 054 | Agent Templates are Claw packages installed in a per-Project registry and interpreted as data | Accepted | Built-in fallback gone (see 058) | [054-agent-templates-are-claw-packages-installed.md](054-agent-templates-are-claw-packages-installed.md) |
| 055 | Template OpenClaw plugins ship inside the package and are installed into the Instance by reconciliation | Accepted | Codegen part gone (see 058) | [055-template-openclaw-plugins-ship-inside-the-package.md](055-template-openclaw-plugins-ship-inside-the-package.md) |
| 056 | The official Template scope is `@opengroow`; `@megaclaw` ids are migrated and read through an alias | Accepted | yes | [056-the-official-template-scope-is-opengroow.md](056-the-official-template-scope-is-opengroow.md) |
| 057 | Official Templates are installed from the hub on demand; only `@opengroow/source` is bootstrapped, from a pinned release | Accepted | Pinned release digest is now set | [057-official-templates-are-installed-from-the-hub.md](057-official-templates-are-installed-from-the-hub.md) |
| 058 | The compiled-in Template bundle is removed; Templates exist only as installed packages | Accepted | yes | [058-the-compiled-in-template-bundle-is-removed-templates.md](058-the-compiled-in-template-bundle-is-removed-templates.md) |
| 059 | Single-account by default, explicit multi-account setting | Accepted | yes | [059-single-account-by-default-explicit-multi-account.md](059-single-account-by-default-explicit-multi-account.md) |
| 060 | Templates are distributed from a hub of release assets; ClawHub comes later | Accepted | yes | [060-template-distribution.md](060-template-distribution.md) |
| 061 | The product and the hosted offer are separate; one generic provisioner, two backends | Accepted | yes | [061-product-cloud-separation.md](061-product-cloud-separation.md) |
| 062 | One dashboard; self-host keeps a login, with a frictionless first run | Accepted | yes | [062-single-dashboard-selfhost-auth.md](062-single-dashboard-selfhost-auth.md) |
| 063 | Product under AGPL-3.0-only, hubs under MIT, contributions by DCO | Accepted | yes | [063-licences.md](063-licences.md) |
| 064 | Global rename megaclaw -> opengroow, with narrow compatibility paths | Accepted | yes | [064-global-rename.md](064-global-rename.md) |
| 065 | The marketing engine stays in the product | Accepted | yes | [065-marketing-engine-stays.md](065-marketing-engine-stays.md) |
| 066 | A `projects` table; the Instance is the Project's runtime | Accepted | yes | [066-projects-table.md](066-projects-table.md) |
| 067 | Machine tools are installed on the paired machine, after consent, from a verified artifact | Accepted | yes | [067-machine-tool-install.md](067-machine-tool-install.md) |
| 068 | Official OpenClaw Plugins are enabled by the operator at start, and the environment variable is the source of truth | Accepted | yes | [068-official-openclaw-plugins-enabled-at-start.md](068-official-openclaw-plugins-enabled-at-start.md) |
