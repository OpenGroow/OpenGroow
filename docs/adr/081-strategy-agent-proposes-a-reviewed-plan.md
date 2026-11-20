# ADR-081: The Strategy Agent proposes a Plan that a human reviews

**Status:** Proposed

## Context

ADR-078 and ADR-079 measure Publications so that a Strategy Agent can decide what to post next. This ADR decides how that agent acts. Creating a Mission in OpenGroow always launches a Run at once (`insertMissionAndDispatch`): a Mission created in `todo` is not parked, it starts. An agent that creates Missions directly is therefore fully autonomous, spending on generations and publications on the strength of numbers it may have misread.

## Decision

- **The Strategy Agent is an ordinary Agent Template**, activated per Project, one per Project, never automatically. No "system agent" kind is added.
- **It runs through a Schedule** (weekly by default) or "Run now". Each run is a Mission of a `plan` Mission type, in the normal cycle.
- **It never creates Missions.** Its deliverable is a **Plan**: at most 5 items, each with a Mission type, a payload, the reason and the figures behind it, and `basedOn`, the done Mission with a measured Publication it starts from (checked at reception and at approval; with nothing measured the Plan is empty and its summary says why). It reports the Plan in its result file and Convex validates it (ADR-052).
- **The Plan is reviewed like any Artifact**, in the Mission's `to_validate` stage. Approve creates and launches the Missions of the items left selected. Reject keeps its existing meaning (`revision_run`): it asks for a feedback and the Strategy Agent plans again in a new Run of the same Mission. The items the user unselects are recorded on the Plan Mission as declined.
- **Each item is validated with the rules of a manual Mission creation**, when the Plan is received and again at approval.
- **Its memory is the history of its Plan Missions**, with declined items and feedback. No strategy table in V1.
- **It reads through the internal MCP** (ADR-080), which is read-only.

## Considered options

- **The Agent creates Missions directly.** Rejected: Missions launch at once, so a wrong reading costs real work before anyone sees it.
- **A new Mission status or a `todo` without a Run for "proposed".** Rejected: it adds a state every consumer of Missions must understand (the Overview counts `todo` as in progress; Stop needs a live Run), and a board column or group for it. The Plan reuses the cycle that already exists.
- **Approve or reject the whole Plan only.** Rejected: with several items, refusing one would mean rejecting and running the Agent again. A per-item selection is the common case.
- **One Mission per proposal, each reviewed on its own.** Rejected: the user would review five scattered cards instead of one Plan, and the Agent could not reason about them together.

## Consequences

- **A new review kind, "plan", and an internal approve effect.** Today's review kinds are `markdown`, `metadata`, `image` and `video`, loaded from an external service (`server` and `path`). Effects are either a bounded HTTP call or `revision_run`, which is already internal: "create Missions from the selected items" is a second internal effect. Convex validates both at install time (`validateManifest`).
- **A selection input.** `ReviewActionInput` has only `text` and `datetime-local`; `approve` needs one that selects Plan items, and its value reaches the effect.
- **Mission provenance.** A Mission only has `sourceObservationId`. A Mission created from a Plan item needs its own optional reference to the Plan Mission so the reason and figures stay readable on it.
- **No aggregated analytics read yet.** `analytics.listForProject` lists Publications (capped at 200); there is no summary by platform, format or Mission type. `get_analytics_summary` (ADR-080) is new work and must exist before the Agent is useful.
- The cap of 5 items is a constant to adjust once real Plans are seen.
- Autonomy (Missions created without review, within a budget) is a later decision, once Plans have proved reliable.
