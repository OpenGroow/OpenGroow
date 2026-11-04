# Publishing

Part of the OpenGroow glossary: see [GLOSSARY.md](../../GLOSSARY.md) for the vision, bounded contexts and term index.

### Publisher

A Project-level integration that turns an approved deliverable into a post on an external service. A Publisher is one **adapter** (V1: Postiz) plus its per-Project configuration (connection, mapping of Publish targets to the service's channels, service-specific settings per target). It has its own page in the dashboard. Agents and Agent Templates never know which Publisher, adapter or channel id is behind a Publish target.

- **Generic by design**: Postiz is only the first adapter; the concept is named after the role, not the tool.
- **Configured per Project**, not per Agent: one configuration serves every Agent of the Project, which removes the duplicated publishing config previously kept in each MCP.
- The Publisher publishes **only** on the human `publish` action of the review, or automatically with `autoPublish`. An Agent never publishes.
- _Avoid_: "Postiz config" (an adapter detail), "publishing MCP".

### Publish target

A logical, human-readable destination a Publishable can be sent to (for example `instagram`, `pinterest:recipes`). It is the only publishing identifier that appears in a Mission or Schedule payload. The Publisher maps it to a real channel; an unmapped target blocks `publish` (or makes the Publication `failed` under `autoPublish`) until the Publisher is configured. An Agent does not choose the target; the human can change it in the review.

- _Avoid_: "channel" (the service's own concept), "board id", "account".

### Publishable

The deliverable of a Mission expressed in the unified publishing format, of one **kind** from a closed set defined by OpenGroow (V1: `video`, `image`, `carousel`). A Publishable carries **references only** (media URLs, ids at the producing service), never content (ADR-010). The Agent Template's manifest declares, per Mission type, the kind it produces and the Publish targets it may go to.

- A new kind is added to the closed set by OpenGroow; it is not declared by a Template.
- _Avoid_: "payload", "post".

### Publication

The tracked outcome of sending one Publishable to one Publish target: one Publication per (Mission, Publish target). It has a status (`pending`, `scheduled`, `published`, `failed`), the external URL or id, the scheduled date and the error. A `failed` Publication can be retried on its own. A Mission is `done` when all its Publications are `published`.

- **Do not confuse** with the Mission's `approved` status ("to publish"): `approved` is the human's validation of the deliverable; a Publication is what happens next.
