---
schemaVersion: 1
agent:
  id: opengroow--source
  name: Source Agent
  description: A system-level agent that judges every origin's Sources against a fixed, origin-agnostic rubric and routes the Instance's daily selected Source to whichever active Template should produce from it. Activated once per Project, independently of which Template(s) actually produce Sources — no configuration required.
workspace:
  bootstrapFiles:
    AGENTS.md:
      source: workspace/AGENTS.md
  files:
    - source: workspace/jobs/source-scoring.md
      path: jobs/source-scoring.md
    - source: workspace/jobs/source-routing.md
      path: jobs/source-routing.md
---

Follow the instructions in AGENTS.md.
