# ADR-024: Pinterest publishing via extending the Video Agent Template, not a separate Template

**Status:** Accepted

### Context

We wanted to publish videos to themed Pinterest boards (Wedding Vows Ideas, Anniversary Letter Ideas, Long Distance Love Letters, Love Letter Ideas, Apology Letters for Relationships). The question was: create a new "Pinterest Agent" Template or extend the existing Video Agent.

### Options considered

- **A — New Pinterest Template.** A separate Template with its own `AGENTS.md`, its 5 themed `missionTypes`, and its board config.
- **B — Extend the Video Agent.** Add a `create_pinterest_pin` `missionType` to the existing Template, with `theme` and `pinterestBoardId` in the payload. The 5 themes are handled via 5 Schedules with distinct payloads, not 5 missionTypes.

### Decision

**B — Extend the Video Agent.** A single `create_pinterest_pin` missionType is added to the Template; the 5 Pinterest themes are carried by 5 independently configured Schedules.

**Reasons:**

1. **Same infrastructure.** Underlying MCP (demo-video-mcp), publishing mechanism (Postiz), deliverable format (video), and External Job contract are identical. A separate Template would fully duplicate this infrastructure without adding anything.
2. **Letter generation is already source-URL-free.** demo-video-mcp already generates letters from scratch (the `concept` field is unused in practice). Passing a `theme` in `missionContext` is a minor extension of the existing contract, not a paradigm shift.
3. **Schedules carry the thematic variation.** The 5 themes × boards are a scheduling concern, not a Template concern. Each Schedule freezes `theme` + `pinterestBoardId` in its payload — that's the right level of abstraction.

### Open blockers (to validate with demo-video-mcp)

1. **Themed generation**: demo-video-mcp must accept a `theme` in `missionContext` (or equivalent) to guide letter generation. Today generation is random.
2. **Pinterest board routing**: demo-video-mcp must accept a `pinterestBoardId` per production call (via `produce_video` or the job config) to route publishing to the right Postiz/Pinterest board.
