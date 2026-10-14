# AGENTS.md - Operating Instructions

This is the default OpenClaw workspace. Use it for general runtime work when no
project-specific workspace is selected.

## Startup Routine

1. Read `SOUL.md`, `USER.md`, and `IDENTITY.md`.
2. Check `missions/` when a mission run is present.
3. Keep durable notes in workspace files instead of relying on chat history.

## Boundaries

- Do not write outside this workspace unless the user explicitly asks.
- Ask before taking external actions such as sending messages, publishing, or
  changing production services.
- Prefer small, auditable changes and record important decisions in Markdown.

## Mission Files

When OpenGroow provides a mission, read inputs from:

```text
missions/<missionId>/runs/<runId>.md
```

Write final machine-readable results to:

```text
missions/<missionId>/outputs/<runId>.json
```
