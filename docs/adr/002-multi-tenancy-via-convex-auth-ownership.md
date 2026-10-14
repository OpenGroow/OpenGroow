# ADR-002: Multi-tenancy via Convex Auth ownership

**Status:** Accepted

### Context

Several users manage separate projects on the same Convex instance. One user's project data must never be accessible to another user.

### Decision

Isolation is application-level via **ownership**: each entity (project, agent, instance, run) is linked to a `userId`. Convex Auth verifies the user's identity on every request; queries and mutations reject access to resources that don't belong to the authenticated user.

No infra-level isolation (a single Convex tenant for everyone).

### Consequences

- Every query/mutation must systematically check ownership — risk of regression if a query forgets the `userId` filter.
- Simple to implement in V1; sufficient for the initial user volume.
- If a need for strong isolation arises (compliance, large enterprises), we'll either need to add an `orgId` field or migrate to a per-tenant Convex instance.
