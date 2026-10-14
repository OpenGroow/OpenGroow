This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `apps/convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

- `commands` — downstream orders (Dashboard → OpenClaw). Keyed by Convex `_id` for idempotency.
- `events` — upstream signals (OpenClaw → Dashboard). De-duped on `(instanceId, eventId)`.
- `projects` — the Project as its own entity: stable id, owner, display name, settings (ADR-066).
- `instances` — the runtime of a Project: lifecycle state for each OpenClaw VM (provisioning → running → stopped), linked by `projectId`.
- `connectTickets` — short-lived tickets for the `openclaw-connect` relay pairing flow.

## Node-only code

If a Convex-related module needs Node APIs such as `node:fs`, `node:path`, `node:url`, or any other Node-only runtime function, always split it:

- keep the Node implementation in a Node-only entrypoint
- move shared types into a type-only or shared subpath
- make browser/client/dashboard code import only the shared or type-only subpath

Do not expose Node-only imports from a package entrypoint that is also consumed by the dashboard or other bundled frontend code, otherwise the bundler may try to resolve those modules in the wrong runtime.
