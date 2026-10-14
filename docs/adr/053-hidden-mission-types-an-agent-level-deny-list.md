# ADR-053: Hidden Mission types — an Agent-level deny-list of Mission types, chosen in Megaclaw

**Status:** Accepted

### Context

The `video` Template declares three Mission types (`lym_create_letter_video`, `lym_create_marketing_video`, `rezon_create_chat_mock_video`), each with its own MCP Manifest, payload and instructions. They cannot be merged: the Manifests differ in schema and in who writes what (the MCP generates the letter for the letter video, the Agent authors it for the marketing video). But the Template is shared by every Project, so the creation form offered every Mission type to every Project — a Rezon video on a LoveYouMake Project. `demo-video-mcp` is the only Template in this situation: its Mission types are specific to a Project's brand. The need is purely presentational — hide what a Project doesn't use — not an access rule.

### Decision

1. **An Agent gains an optional `hiddenMissionTypes` list**, edited by the operator in Megaclaw. Absent or empty = nothing hidden, so every existing Agent and every Template that does not use it behaves exactly as before. The Template declares nothing: the UI lists the Template's own `missionTypes` and the operator ticks the ones to hide.
2. **It is a deny-list, not an allow-list.** A new Mission type added to a Template appears on every Agent by default, as it does today for every Template. Entries naming a type the Template no longer declares are ignored.
3. **It is presentation only.** The Create Mission and Create Schedule forms do not offer a hidden type, and the workspace no longer carries its instruction file. There is no server-side guard: Missions and Schedules that already exist, or are created through the API, with a hidden type keep working. Review contracts still resolve from the whole manifest.
4. **The setting is editable at any time once the Agent is active** — the control lives on the active Agent's card, and every change re-materializes the workspace — independently of Reconfiguration (it is not Template config and `requirements` cannot express a multi-select). It cannot be pre-set before the first Activation: the setting is stored on the Agent record, which exists from Activation. It is only offered when the Template declares more than one Mission type: with a single type there is nothing to choose between, and hiding it would just disable the Agent's Missions, which is what deactivating is for.

### Considered options

- **An allow-list of enabled types** (hidden by default): a type added to the Template later would be invisible until enabled, which protects a Project from another brand's new formats. Rejected for simplicity and because the feature is cosmetic; the cost is that adding a Mission type for a new brand makes it appear on other Projects until hidden there.
- **The MCP reports which Mission types a Project supports** (a `status_check` extension, ADR-034 style): single source of truth, but it needs a change and a deployment-order constraint on `demo-video-mcp`, gates the Video Agent's Activation on a new `status_check`, and the set is only a snapshot taken at Activation/Reconfiguration. Rejected as disproportionate for a single-Template exception; a more automatic mechanism can be designed if the case recurs on other Templates.
- **One Template per brand** (`video-lym`, `video-rezon`): duplicates the manifest and turns the brand back into a Template name, against the Agent / Mission type / Config separation rule.
- **A server-side guard refusing hidden types**: out of scope — the feature is not a permission.

### Consequences

- Nothing changes outside the setting: Templates and Agents that never set it are untouched.
- An operator can hide the types a Project cannot produce, but nothing checks that the MCP actually supports the types left visible: a Mission of a type the MCP has not configured for the Project fails at the Agent's `get_project_status` preflight with the MCP's own message, as it does today.
- `writeTemplateWorkspaceFiles` only writes; it never removes. Hiding a type on an already-materialized workspace therefore requires an explicit removal of that type's instruction file (`validateManifest` already guarantees each Mission type owns a unique `agentsMd` path), and hiding or un-hiding must re-materialize the workspace.
- The letter video's `format` (`hook-plus-letter` | `letter-only`) becomes an explicit `select` payload field, default `hook-plus-letter`, replacing the orphaned `defaultFormat` run-context value that no config has provided since ADR-034.
