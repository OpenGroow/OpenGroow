# ADR-061: The product and the hosted offer are separate; one generic provisioner, two backends

**Status:** Accepted (#722; implemented by #713 and #719, spec #710). Supersedes in practice the hosted-topology parts of ADR-005 and ADR-031, which stay as historical records.

## Context

The same code used to serve self-host and the hosted offer, with provider-specific provisioning (`hetzner.ts`, a 94-line HMAC client), a cloud control service and deployment manifests in one repository. Publishing the product would have published the hosted topology.

## Decision

- **One generic provisioner.** Convex provisions Instances through `instance_provisioning/control_plane.ts`, selected by configuration (`INSTANCE_PROVISIONER`, `OPENCLAW_CONTROL_URL`, HMAC key). Whatever sits behind the URL implements `docs/CONTROL_PLANE.md`. The product ships one implementation, `openclaw-local-control` (Docker Compose, self-host).
- **The hosted offer is a separate private repository with its own backend** (two backends). It holds the cloud control service, fleet, billing and deployment. The product contains no cloud code; `scripts/no-cloud-code.test.ts` guards this.
- **The API contract is the only coupling**, four points, all HMAC-signed (docs/HMAC.md): quota (the cloud refuses to create an Instance without a valid subscription), usage events, fleet, identity. Only provisioning exists today.
- **The hosted offer lists public, official Templates only.** No private Template runs on the cloud (ADR-060).
- **Reversible.** Two backends can be merged later. A single Convex mixing product and cloud data could not be split, which is why we start separated.

## Alternatives considered

- **One Convex with a capability system**: smallest diff today, but irreversible, and it ships cloud tables and logic with the product.
- **Closed-source fork of the product for the cloud**: diverges immediately; every product fix is a merge.
- **A plugin interface in the product for cloud features**: designs an extension system for one consumer.

## Consequences

- The product is identical at runtime in self-host and cloud; only the provisioner branch differs.
- Quota, usage, fleet and identity endpoints are designed when the cloud backend is built, against this principle, not before.
- Hosted-topology ADRs (infrastructure, security) are not carried into the public repository (docs/CUT-DOC-REVIEW.md).
