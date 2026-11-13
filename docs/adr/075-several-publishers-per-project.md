# ADR-075: A Project has several Publishers, at most one per adapter

**Status:** Proposed (amends ADR-069)

## Context

ADR-069 set one Publisher per Project (V1): Postiz was the only adapter and served every social network. ADR-074 adds a GitHub Publisher for site articles. A Project that publishes both social posts and articles needs both, but the core refused a second Publisher: `publishers` was looked up by Project with `.unique()`, and the dashboard disabled "Add publisher" once one existed.

## Decision

- **Several Publishers per Project, at most one per adapter.** A Publisher is identified by `(Project, adapter)`: one Postiz and one GitHub, not two Postiz. The Publisher mutations and actions (`save`, `addChannel`, `updateSettings`, `setChannelProfiles`, `removeTarget`, `remove`, `testConnection`, `listChannels`) take the `adapter`; `publishers.list` returns all of them.
- **A channel key is unique across the Project's Publishers.** Missions and Schedules keep naming channels by key only (`payload.publishTargets`, unchanged): the key says which Publisher carries the channel. Adding a channel whose key another Publisher already has is refused.
- **Each channel goes through its own Publisher.** Publishing, retry reconciliation and polling resolve each target to its Publisher (`apps/convex/project_publishers.ts`) and use that Publisher's connection and plugin. The checks that read capabilities (`assertChannelsSupportKind`) or `scheduling: false` (`assertSchedulable`) apply per channel, so a `publishAt` is refused only when one of the chosen channels is on a Publisher that cannot schedule.
- **A package declares the platforms it offers, with their logos.** `capabilities.platforms` is the list of platforms a Publisher offers in OpenGroow: a channel on another platform is not proposed and cannot be added. Each platform may carry its logo (`icon`, a data URI shipped in the package). A channel shows that logo, else the package icon: one rule for every Publisher, with no request at display time (Postiz used to serve the logos from its instance; GitHub serves none).
- **A Publisher can be removed.** Its connection and channels go; its Publications stay (history). A Mission or Schedule still naming one of its channels is refused at publish time ("Unknown channel") until other channels are chosen.

## Considered options

- **Any number of Publishers, even of the same adapter** (two Postiz instances). Rejected for now: every mutation would need a Publisher id and the dashboard a name per Publisher, for a case nobody has. Lifting the limit later only adds an id; channel keys already stay unique.
- **Keys scoped by Publisher** (`postiz/instagram:me`). Rejected: it changes every stored payload, and a `<platform>:<handle>` key already names one account.

## Consequences

- No migration: an existing Project has one Publisher, which is a valid state.
- The review's channel picker lists the channels of all the Project's Publishers; each channel's logo and capabilities come from its own Publisher.
- `publisherReady` (review) means every Publisher of the chosen channels has its API key.
