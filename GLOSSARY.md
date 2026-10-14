# Glossary — OpenGroow Domain Model

This file documents the Ubiquitous Language and the domain model of OpenGroow following Domain-Driven Design principles.

It is the entry point: vision, contexts, a term index and the aggregates. Detailed definitions live in `docs/domain/` (one file per domain, loaded only when needed). It is authoritative for the terminology used in the code, ADRs, tickets, and team conversations. In case of conflict between this file and another document, this file prevails.

---

## Domain Vision

OpenGroow is a graphical, standardized layer on top of OpenClaw. It gives developers a declarative contract (Agent Template manifest, `requirements`, effects) to plug external MCP servers into the Mission/Review lifecycle without hand-coding against OpenClaw's limited skills system, and it lets any user — technical or not — create, configure, and supervise the resulting autonomous AI agents: schedule coordinated tasks, track each Mission's progress and logs, and review its output (`to_validate`, approve/reject/publish, pause).

Marketing is the first domain built on this model (agents producing articles, content plans, competitive analyses…), but the model itself is domain-agnostic — a monitoring/watch agent or any other kind follows the same Agent/Mission/Review lifecycle. The execution infrastructure is fully abstracted away: the user only ever sees Projects, Agents, and Missions — never VMs, workers, or brokers.

---

## Bounded Contexts

The domain is split into three contexts with distinct responsibilities.

```
┌──────────────────────────────┐   ┌──────────────────────────────┐
│   PROJECT SPACE              │   │   MISSION EXECUTION          │
│                              │   │                              │
│  Project                     │──▶│  Mission                     │
│  ProjectAgent                │   │  Run                         │
│  AgentTemplate               │   │  Artifact                    │
│  Brand Core                  │   │  RunResult                   │
└──────────────────────────────┘   └──────────────────────────────┘
                                              │
                                              ▼  (Anti-Corruption Layer)
                              ┌──────────────────────────────┐
                              │   RUNTIME INFRASTRUCTURE     │
                              │                              │
                              │  Instance                    │
                              │  Command                     │
                              │  Event                       │
                              │  ConnectTicket                │
                              └──────────────────────────────┘
```

> The **Runtime Infrastructure** context must never pollute the business language. UI code and business Convex mutations speak of Projects, Agents, and Missions — not instances, commands, or WS events.

---

## Term index

Canonical terms to use in code, PRs, tickets, and conversations. Do not use synonyms not listed here.

Definitions are in `docs/domain/`. Read the file of the domain you work on; do not load them all.

| Term | Summary | File |
| --- | --- | --- |
| **Project** | Business environment of a brand or business context. Also defines: Do not confuse, Persistence. | [docs/domain/project-and-agents.md](docs/domain/project-and-agents.md) |
| **Agent** | AI entity configured within a Project, capable of executing Missions of a given type. Also defines: Activation, Reconfiguration, Frozen config vs reconfigurable config, Config Completeness, Instagram account, Visual Description. | [docs/domain/project-and-agents.md](docs/domain/project-and-agents.md) |
| **Provider** | AI model route configured for a Project's Instance — either a linked OAuth subscription (e.g. | [docs/domain/project-and-agents.md](docs/domain/project-and-agents.md) |
| **Hub** | A repository that distributes Agent Templates and machine-side tools, with a fixed layout: Also defines: `groowhub`, `private-groowhub`, `tools/`. | [docs/domain/templates.md](docs/domain/templates.md) |
| **Deployment** | The product is the same code in self-host and in the hosted offer. Also defines: Two-backend principle, One dashboard, Self-host authentication. | [docs/domain/templates.md](docs/domain/templates.md) |
| **Agent Template** | Reusable blueprint defining the capabilities, available MCP tools, and instructions of an Agent type. Also defines: Trust level, Official, Mission-type contracts are explicit, No Convex code per Mission type., Hidden Mission types. | [docs/domain/templates.md](docs/domain/templates.md) |
| **Tool** | A program on the user's own machine (the paired Node host), called by an Agent through exec on that Node (e.g. | [docs/domain/templates.md](docs/domain/templates.md) |
| **Mission** | User intention: Also defines: Mission statuses, Context injected at execution time, Waiting for device, Available device, Execution device, Deletion. | [docs/domain/missions.md](docs/domain/missions.md) |
| **Schedule** | Recurrence rule that automatically generates Missions at a defined cadence, without user intervention. | [docs/domain/missions.md](docs/domain/missions.md) |
| **Run** | Attempt to execute a Mission by an Agent. Also defines: Mission/Run relationship, Run statuses. | [docs/domain/missions.md](docs/domain/missions.md) |
| **Blocker** | A human-action condition declared by an Agent Template that can stop one of its Missions outside OpenGroow's own review flow. | [docs/domain/missions.md](docs/domain/missions.md) |
| **RunResult** | Terminal value produced by a Run upon completion. | [docs/domain/missions.md](docs/domain/missions.md) |
| **Intermediate Result** | Non-terminal value produced by OpenGroow upon completion of an intermediate External Job. | [docs/domain/missions.md](docs/domain/missions.md) |
| **External Job** | Long-running asynchronous work launched by an Agent in an external service during a Run. | [docs/domain/missions.md](docs/domain/missions.md) |
| **Artifact** | Business deliverable produced by a Run, viewable by the user. Also defines: Engagement Session. | [docs/domain/missions.md](docs/domain/missions.md) |
| **Marketing Mock** | Illustrative, fictional demonstration of a product behavior intended to make | [docs/domain/missions.md](docs/domain/missions.md) |
| **Brand Core** | Persistent business knowledge, curated by the human, attached to a Project, read by all Agents of the Project to contextualize their work. Also defines: Written by the human, static, Do not confuse, Composition at execution time. | [docs/domain/missions.md](docs/domain/missions.md) |
| **Source** | A Source is one dated, machine-written record of something an Agent saw in the outside world — a social post, a search keyword, a product signal —… Also defines: Source declaration, Three layers, Append-only, Enrichment is optional, Pipeline status is derived, not stored, Selection lifecycle. | [docs/domain/marketing-engine.md](docs/domain/marketing-engine.md) |
| **Source Agent** | The source Agent Template (ADR-052): Also defines: `score`, `routing`. | [docs/domain/marketing-engine.md](docs/domain/marketing-engine.md) |
| **SourceJob** | The unit of work that fills the database with a Source: Also defines: One SourceJob per Agent, batched. | [docs/domain/marketing-engine.md](docs/domain/marketing-engine.md) |
| **Observation** | Retired term: | [docs/domain/marketing-engine.md](docs/domain/marketing-engine.md) |
| **Creative Family** | A named creative pattern or mechanic an Instance's Sources get grouped into (e.g. Also defines: Descriptive only in V1. | [docs/domain/marketing-engine.md](docs/domain/marketing-engine.md) |
| **Replication Score** | A composite 0–1 score on a scored Source, expressing how good an inspiration it is to replicate for *this Instance's own product* — not how viral… Also defines: Weighted sum of four sub-scores, Optimizes for fit, not virality, Gated, not always-decisive. | [docs/domain/marketing-engine.md](docs/domain/marketing-engine.md) |
| **Engagement Score** | The Replication Score's performance sub-score: | [docs/domain/marketing-engine.md](docs/domain/marketing-engine.md) |
| **Android Plugin** | Local extension co-installed on the Mac host of the OpenClaw Instance. Also defines: App profiles. | [docs/domain/android.md](docs/domain/android.md) |
| **Workspace** | File space local to the OpenClaw Instance where the Agent reads its instructions (AGENTS.md) and Mission contexts. Also defines: Workspace kind. | [docs/domain/runtime.md](docs/domain/runtime.md) |
| **Per-mission instructions** | Mission-type-specific workflow and tools, stored as a separate .md file in the Agent Template directory. | [docs/domain/runtime.md](docs/domain/runtime.md) |
| **Instance** | Execution environment that runs the Agents of a Project. | [docs/domain/runtime.md](docs/domain/runtime.md) |
| **Official OpenClaw Plugin** | An OpenClaw plugin published by the OpenClaw project itself (Codex, WhatsApp, Xiaomi, Groq) that an operator chooses to offer on an Instance. | [docs/domain/runtime.md](docs/domain/runtime.md) |
| **Command** | Order sent from Convex to an OpenClaw Instance via the Broker (e.g. | [docs/domain/runtime.md](docs/domain/runtime.md) |
| **Event** | Signal emitted by an OpenClaw Instance to Convex via the Broker. | [docs/domain/runtime.md](docs/domain/runtime.md) |
| **ConnectTicket** | Ephemeral ticket allowing a local (dev) OpenClaw process to be associated with a Project via openclaw-connect. | [docs/domain/runtime.md](docs/domain/runtime.md) |
| **Node** | Local OpenClaw execution process (host running openclaw-connect) awaiting or holding approval to serve a Project's Instance. | [docs/domain/runtime.md](docs/domain/runtime.md) |
| **Node Identity** | Persistent credential (key/signature) a Node holds to authenticate itself to the Broker on behalf of an Instance, established once the… | [docs/domain/runtime.md](docs/domain/runtime.md) |

## Aggregates and Roots

| Aggregate    | Root       | Contains                  |
| ------------ | ---------- | ------------------------- |
| **Project**  | `Project`  | ProjectAgents, Missions, Brand Core |
| **Mission**  | `Mission`  | Runs                      |
| **Instance** | `Instance` | Commands (via instanceId) |

Aggregates are traversed through their root. Never modify a Run without going through its Mission; never send a Command without going through its Instance.

---

## What the user never sees

Internal terms that must not appear in the UI nor in user-facing messages:

- Instance, VM, Worker, Broker, WebSocket
- Command, Event, Dispatch, Queue
- `needs_human_review` (→ "To validate"), `instanceId`, `sessionKey`
- OpenClaw, MCP (except in advanced configuration context)
