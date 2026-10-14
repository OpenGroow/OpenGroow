# ADR-028: `InstanceProvisioner` seam for OSS single-Project self-hosting

**Status:** Accepted

### Context

Megaclaw's SaaS deployment provisions OpenClaw instances as Hetzner VMs via `openclaw-control` (ADR-005): `apps/convex/instances_node.ts`'s `createJob` action calls `callControlApi` directly. The project is being packaged as an OSS self-hosted product (issue #261) that runs a single Project as a compose-managed container, with no Hetzner API, no VM provisioning, and no multi-tenant orchestration.

The generic Mission/Run/Review engine (Missions, Runs, Commands, Events) has no reason to know how an Instance was provisioned. But today it's coupled to Hetzner through a direct function call, and the `instances` table schema mixes generic runtime state with Hetzner-specific provisioning metadata (server ids, network ids, broker private IPs). A contributor cloning the OSS mirror would otherwise see, and have to reason about, Hetzner-only code and fields that don't apply to their deployment.

### Decision

Introduce an `InstanceProvisioner` interface — `createInstance(ctx, args): Promise<InstanceProvisionResult>` — with two implementations in separate modules under `apps/convex/instance_provisioning/`:

- `hetzner.ts` — wraps the existing `callControlApi` flow, behavior unchanged. Private-repo-only.
- `local.ts` — writes a single `instances` row pointing at the compose-managed OpenClaw container, no external HTTP call, and enforces the single-Project constraint (issue #262) by rejecting a second row.

A single composition file (`instance_provisioning/index.ts`) selects the implementation that `instances_node.ts`'s `createJob` depends on. In this private repo it always wires `hetzner.ts`. When the OSS mirror is generated (issue #269), that composition file is rewritten to wire `local.ts`, and `hetzner.ts` is omitted from the export entirely — the seam is structural (a file that isn't exported), not a runtime flag a self-hoster could misconfigure or a contributor would need to read past.

The `instances` table schema is split accordingly: generic runtime state shared by both deployment modes (`runtimeStatus`, `whatsAppChannel`, `telegramChannel`, `aiConfig(s)`, `speechToText`, `workspaceList`, `ipv4`, `userId`, `updatedAt`) versus Hetzner-only provisioning fields (`jobId`, `networkId`, `networkName`, `brokerServerId`, `brokerPrivateIp`, `openclawServerId`, `openclawName`, `openclawId`, `openclawKeyId`).

**Alternatives considered:**

- A runtime flag (`DEPLOYMENT_MODE=local|hetzner`) branching inside a single provisioner — rejected because it would ship Hetzner-specific code and reasoning burden into the OSS export even when unused, and because a self-hoster could theoretically flip it and hit a code path that assumes infrastructure (Hetzner API keys) they don't have.
- Multi-Project orchestration inside the OSS deployment — explicitly out of scope; a second independent `docker compose up` stack already gives an isolated second Project (see PRD #261). `InstanceProvisioner` is the extension point for a contributor who wants to attempt real Docker orchestration, but that isn't accepted as a small patch.

### Consequences

- `createJob` — the only action that *provisions* a new Instance — depends only on the `InstanceProvisioner` interface, never on `callControlApi` directly.
- The other Hetzner-specific fleet-management actions in `instances_node.ts` (`refreshJob`, `removeInstance`, `destroyAllInstances`, `rollout`, the OpenClaw/broker log and status actions) still call `callControlApi` directly, imported from `hetzner.ts`. They stay Hetzner-only on purpose: a self-hosted single compose-managed container has no equivalent of "poll a Hetzner job," "roll out N VMs," or "delete a server" — its lifecycle is `docker compose up`/`down`, not a Convex action. Extending `InstanceProvisioner` to cover them would add methods no self-host implementation needs. If the OSS export ever needs local equivalents (e.g. "remove my Project"), that's a separate, later seam.
- The Hetzner path's existing behavior and test coverage are unchanged — this is a pure extraction, not a rewrite.
- `local.ts` is unit-testable in isolation: given provisioning args, it returns a well-formed job payload and makes no HTTP calls.
- The single-Project constraint only exists in `local.ts` — Hetzner (SaaS, multi-instance) is unaffected.
- A future real multi-instance OSS orchestrator would be a third `InstanceProvisioner` implementation, not a rewrite of the seam.
