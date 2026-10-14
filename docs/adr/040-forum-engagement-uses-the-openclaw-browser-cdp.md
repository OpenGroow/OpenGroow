# ADR-040: Forum Engagement uses the OpenClaw browser (CDP), not the Android Plugin

**Status:** Accepted

Social Engagement automates a specific mobile app (Instagram) through the Android Plugin's semantic-action CLI, built around fixed app profiles. A Forum Engagement Agent instead targets arbitrary discussion forums reachable as ordinary websites, where no per-app profile exists and never will for every forum a customer might pick. Building forum support as Android app profiles would mean writing (and maintaining) one profile per forum, defeating the reason app profiles exist. Forum Engagement Agents therefore drive OpenClaw's existing generic `browser` tool (Chrome via CDP) instead, treating the forum's own web UI as the interface — the same way a human would use it — rather than adding a new class of Android app profile.
