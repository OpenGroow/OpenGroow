# ADR-033: Local-multi is the only self-host provisioning model; single-Project infrastructure removed

**Status:** Accepted

### Context

Local-multi provisioning (issue #303/#305/#306) already replaced ADR-028's single-Project constraint and ADR-030's single-Project dashboard home at the application layer: `apps/convex/instances.ts`'s `createLocalInstance` has taken no existing-row check since #306, and `dashboard-home-selfhost.tsx` (ADR-030's redirect component) was deleted and `apps/dashboard/app/(app)/page.tsx` rewritten to render the shared multi-Project `DashboardHome` unconditionally — both landed as part of shipping local-multi.

What #306 never did was a matching removal pass at the infrastructure layer. Left behind, still wired into `docker compose up`:

- `apps/openclaw-docker-config/docker/docker-compose.selfhost.yml` — a one-shot `openclaw-secrets-bootstrap` service generating a single fixed credential set and hardcoding the Convex-side `openclawId` to the literal string `"local"`.
- Static `openclaw-gateway`/`openclaw-runtime-worker` service declarations in the root `docker-compose.yml`, alongside their `docker-compose.dev.yml` hot-reload stanzas.
- Dead getters in `apps/convex/env.ts` (`OPENCLAW_GATEWAY_TOKEN`, `OPENCLAW_INSTANCE_ID`) — `OPENCLAW_GATEWAY_TOKEN`'s own comment already stated "no code path reads this getter anymore," and `OPENCLAW_INSTANCE_ID` had zero callers.
- A regression test in `apps/convex/test/instance_provisioning.test.ts` asserting `createLocalInstance` doesn't disturb a simulated pre-#306 `openclawId: "local"` row — a scenario nothing could produce anymore.
- The private repo's `README.md` and the OSS export's generated quickstart README (`scripts/export-oss-mirror.sh`) both still promised "one `docker compose up`" gives you a working Project — already inaccurate, since Project creation has required `openclaw-local-control` running separately since #306.

None of this caused a bug — an unused Docker Compose service or an unread env getter doesn't fail a build or a test the way dead TypeScript does — so it was never forced onto anyone's plate. It sat as reasoning burden and a second, non-functional "mode" a reader could mistake for supported.

### Decision

Delete the single-Project infrastructure entirely rather than leave it dormant:

- Removed `docker-compose.selfhost.yml`, the static `openclaw-gateway`/`openclaw-runtime-worker` declarations in `docker-compose.yml`, and their `docker-compose.dev.yml` watch stanzas.
- Kept the `openclaw-secrets` named volume (moved its declaration into `docker-compose.yml`'s own `volumes:` block) and the `broker`/`convex-bootstrap` services' references to it that still apply — that volume is not single-Project-specific: `openclaw-local-control`'s `broker-sync` (issue #303/#307) `docker cp`s a regenerated key registry into it for every local-multi instance, continuously, in normal operation.
- Removed the now-dead `OPENCLAW_GATEWAY_TOKEN`/`OPENCLAW_INSTANCE_ID` env getters and the entrypoint.sh logic that populated them.
- Removed the legacy-row regression test; the general "doesn't disturb other instances" behavior it partially overlapped with stays covered by the adjacent multi-row test.
- Rewrote `README.md`, `.env.example`, and the OSS export's generated quickstart to state plainly: this stack has no OpenClaw gateway of its own, and there is exactly one way to get a running Project — through the dashboard, which talks to `openclaw-local-control` (any number of Projects, not "one, plus a manual second-Project workaround").

**Alternatives considered:**

- Leave the dead infrastructure in place, undocumented — rejected: this is the state that already existed and prompted this ADR. Nothing about it was going to become someone's priority on its own.
- Keep single-Project as an explicit, supported "minimal" mode alongside local-multi — rejected: it would mean maintaining two self-host provisioning paths with real infrastructure (a second bootstrap service, a second credential-generation scheme) for a "simpler" mode whose only actual advantage was one fewer terminal command, at the cost of every self-hoster and contributor needing to understand which mode applies to their deployment.

### Consequences

- `docker compose up` alone never creates a Project; `openclaw-local-control` must always be running for "Create New Project" to work — there is no zero-click path anymore, matching what the docs already instructed in practice.
- Every self-host Project, from the first one, goes through the exact same dynamic-provisioning path SaaS-style multi-instance testing already exercises — one fewer code path to reason about or regress.
- A fresh clone's `docker compose up` brings up strictly the shared platform (Convex, broker, dashboard, openclaw-connect); the OpenClaw gateway/runtime-worker image is only built when `openclaw-local-control` provisions the first Project (or via `pnpm openclaw:local`, for iterating on that image directly).
- ADR-028 and ADR-030 stay as written above — historical record of the single-Project design and its rejected alternatives — this ADR is what finally removed what they describe, rather than an edit to either.
