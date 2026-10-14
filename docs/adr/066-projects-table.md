# ADR-066: A `projects` table; the Instance is the Project's runtime

**Status:** Accepted (#724, parent #710 phase 4). Widen, migrate and narrow shipped (see "Narrow" below).

## Context

The Project was a row of `instances`: its display name and owner sat next to provisioning fields shaped after a hosting provider (`jobId`, `networkId`, `brokerServerId`, `openclawServerId`). Its identifier, `openclawId`, is optional and only arrives at the end of a remote provisioning, so the identity changed during the Project's life. Seventeen other tables key by `instanceId`; `installedTemplates` and `templateMcpUrlOverrides` already say `projectId`. The cloud needs a place for per-Project name, quotas and subscription.

## Decision

- **New `projects` table**: `_id` is the stable identity from the first moment; `projectId` is the string identifier the other tables store; `ownerId`, `displayName`, `settings`, timestamps.
- **`instances.projectId`** (`v.id("projects")`) links the runtime to its Project. `instances` keeps runtime and provisioning data.
- **Same identifier value, nothing else rewritten.** The backfill sets `projects.projectId = instances.openclawId` unchanged, so `instanceId` and `projectId` columns elsewhere stay valid. Renaming those columns is optional and not planned.
- **A Project exists before its OpenClaw id.** `saveJob` / `createLocalInstance` create the Project with the Instance. `projects.projectId` is set once, when the OpenClaw id first appears (immediately for a local Instance, where job id equals OpenClaw id), and never changes: a later different `openClawId` from the control plane (re-provisioning) does not move it.
- **Widen / migrate / narrow** with `@convex-dev/migrations`: (1) widen: `projects` and the optional `instances.projectId`; writes go to the Project and, for name and owner, still to the legacy `instances.displayName` / `userId`; reads prefer the Project and fall back to the legacy field. (2) migrate: `backfillProjectsFromInstances` (batched, idempotent, in `PENDING_MIGRATIONS`). (3) narrow, in a later release once the backfill is verified: make `instances.projectId` required, drop `displayName` and `userId` from `instances`. This ADR does not bundle any other data migration, and must not ship in the same release as another one.
- **Re-provisioning and `openclawId`** (verified in code): nothing in the repository recreates an Instance under the same job. Local `rollout.ts` recreates the Compose project under the same id (the id is the Compose project name). On the remote path, `saveJob` upserts by `jobId` and overwrites `openclawId` with whatever the control plane returns (`args.job.openclaw?.openClawId ?? existing.openclawId`); whether the control plane ever returns a different id for the same job is not observable here. That is why identity must not depend on `openclawId`.

## Consequences

- Dashboard `instances.list` returns the Project's name; user-facing copy says Project, "Instance" only where the runtime is meant.
- Ownership checks (`instance_ownership.ts`, rename) read the owner from the Project first.
- Open item: for a remote Project whose OpenClaw id differs from a pre-existing `projectId` after re-provisioning, the runtime id and the Project identifier diverge; callers keyed by `instanceId` would need a mapping through `instances.projectId`. Not needed today.

## Narrow

The backfill has run on every deployment, so `instances.projectId` is now **required** and `backfillProjectsFromInstances` is gone (with `ensureProjectForInstance`). The owner is read from `projects.ownerId` only and the name from `projects.displayName`; nothing reads or writes `instances.userId` / `displayName` any more, and the `by_user_id` index and `listByUserId` are removed.

Convex rejects a schema that omits a field still present in stored rows, so the two legacy fields stay declared as optional for one release. `clearLegacyInstanceFields` (in `PENDING_MIGRATIONS`) unsets them.

**Final step** (#724): once `clearLegacyInstanceFields` had run, the `userId` and `displayName` declarations and the migration were deleted. `instances` now holds runtime and provisioning data only.
