---
schemaVersion: 1
agent:
  id: opengroow--engagement
  name: Engagement Agent
  description: A generic engagement agent used as a test package. It processes a feed of posts in time-bounded sessions (see `sessionDurationMs`); daily rhythm is managed by OpenGroow Schedules.
workspace:
  bootstrapFiles:
    AGENTS.md:
      source: workspace/AGENTS.md
  files:
    - source: workspace/engage.md
      path: engage.md
    - source: workspace/sources/video-post.md
      path: sources/video-post.md
    - source: workspace/sources/image-post.md
      path: sources/image-post.md
packages:
  - kind: skill
    source: clawhub
    ref: humanize
    version: 1.0.0
---

Follow the instructions in AGENTS.md.
