# Runtime: Workspace, Instance, Command, Event, Node

Part of the OpenGroow glossary: see [GLOSSARY.md](../../GLOSSARY.md) for the vision, bounded contexts and term index.

### Workspace

File space local to the OpenClaw Instance where the Agent reads its instructions (`AGENTS.md`) and Mission contexts.

- Canonical mission path: `missions/<missionId>/`
- Results path: `missions/<missionId>/outputs/<runId>.json`
- The Agent must never write outside `missions/<missionId>/`.
- The Workspace is **not** deliverable storage: the produced content (articles, images…) stays in the external service that generated it.
- **Workspace kind** (`RuntimeWorkspaceKind` in `@opengroow/protocol`): discriminates the origin / lifecycle of each workspace. The five values are `default` (primary workspace, auto-created), `profile` (backed by an OpenClaw profile preset), `legacy` (carried over from a previous provisioning format, backward-compat only), `custom` (user-created via `runtime.workspace.create`), and `managed` (auto-created and owned by an Agent Template at activation — e.g. `video`, `seo`, `social-engagement`). The canonical type and its JSDoc live in `packages/protocol/src/index.ts`; all consumers must import from `@opengroow/protocol` rather than redefining the union locally.

### Per-mission instructions

Mission-type-specific workflow and tools, stored as a separate `.md` file in the Agent Template directory. Declared via `agentsMd` on `MissionType` in the manifest. Activation and refresh copy it to the same relative path in the managed workspace, where it is visible under Workspace Files. The dispatcher composes it with the base `AGENTS.md` at dispatch time, so the agent only loads instructions relevant to its current mission type.

- _Avoid_: mission-specific AGENTS.md (ambiguous — could mean the composed file or the per-mission file)

> **Infrastructure Concepts (Anti-Corruption Layer).** The infrastructure terms below (Instance, Command, Event, ConnectTicket, Node, Node Identity) belong to the **Runtime Infrastructure** context. They must not appear in the business language exposed to the user nor in high-level Convex mutations.

### Instance

Execution environment that runs the Agents of a Project. An Instance is created, started, and can be reprovisioned transparently to the user.

- **Provisioning is deployment-mode-specific, not part of the domain concept.** In the hosted (SaaS) deployment, an Instance is an OpenClaw VM provisioned by a remote control plane (docs/CONTROL_PLANE.md). In the self-hosted (open source) deployment, an Instance is a Docker Compose project provisioned dynamically, on demand, by `openclaw-local-control` when a Project is created from the dashboard — there is no limit on how many Instances a self-hosted deployment can run (see ADR-033, docs/adr/033-local-multi-is-the-only-self-host-provisioning-model.md).

- An Instance belongs to exactly one Project. The `projects` table holds the Project and `instances` its runtime, linked by `instances.projectId` (ADR-066); `instanceId` remains the string key used by the other tables (see **Project**). In the vocabulary, a Project is what the user owns, an Instance is where its Agents run.
- Infrastructure lifecycle: `queued` → `running` → `succeeded` / `failed`
- Runtime lifecycle: `provisioning` → `starting` → `created` → `linked` / `failed`
- From a DDD perspective: the Instance is an **Infrastructure Resource** attached to a Project. The user thinks _"my Acme project"_, not _"my openclaw-acme-42 instance"_.

### Official OpenClaw Plugin

An OpenClaw plugin published by the OpenClaw project itself (Codex, WhatsApp, Xiaomi, Groq) that an operator chooses to offer on an Instance. It is not shipped with an Agent Template, and the product image carries none of them: an Instance has exactly the ones its operator enabled, and the Dashboard offers only the features of those.

- A Template's **Plugin** (see Tool) is different: it travels with an Agent, whatever the operator chose.
- Removing an Official OpenClaw Plugin from an Instance removes its configuration with it (for WhatsApp, the paired channel).
- The operator-facing variable `OPENCLAW_OPTIONAL_PLUGINS` and the code that reads it (`optional-plugins.*`, `OptionalPluginId`) keep the word "optional": it names the _choice_ the operator makes, and the variable is a deployment contract.
- _Avoid_ in prose and UI: "optional plugin", "provider plugin", "extension".

### Command

Order sent from Convex to an OpenClaw Instance via the Broker (e.g. start a Run, read a result). Commands are identified by their Convex `_id` to guarantee idempotence.

### Event

Signal emitted by an OpenClaw Instance to Convex via the Broker. Events update the state of Missions and Runs in real time.

### ConnectTicket

Ephemeral ticket allowing a local (dev) OpenClaw process to be associated with a Project via `openclaw-connect`. Valid for a few minutes.

- Consumed exactly once, at first pairing. It does not persist beyond that: once consumed, ongoing authentication is the **Node Identity**'s responsibility, not the ConnectTicket's.

### Node

Local OpenClaw execution process (host running `openclaw-connect`) awaiting or holding approval to serve a Project's Instance. A Node is what the connect wizard (dashboard) approves via `requestNodeApprove`.

- _Avoid_: "device" as a synonym for Node in the connect-wizard/pairing flow (`handleApproveDevice`, `saveConnectedDevices`, "pending device") — this is a legacy naming duplication to be cleaned up, not a distinct entity. Reserve **device** exclusively for the Android Plugin's physical phone (see Android Plugin) — a different concept plugged into a Node, not the Node itself.

### Node Identity

Persistent credential (key/signature) a Node holds to authenticate itself to the Broker on behalf of an Instance, established once the ConnectTicket is consumed and living independently of it afterwards.

- Distinct from the ConnectTicket: the ConnectTicket is a one-time initial association; the Node Identity is the ongoing proof of "this process is still the legitimate Node for this Instance," and can become invalid later (e.g. clock skew, expiry) without the initial pairing being at fault.

---
