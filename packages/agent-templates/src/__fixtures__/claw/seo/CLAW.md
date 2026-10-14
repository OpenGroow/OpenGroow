---
schemaVersion: 1
agent:
  id: acme--seo
  name: SEO Agent
  description: "A specialised marketing agent for search engine optimisation: site audits, SERP analysis, keyword research, article generation, and image generation."
workspace:
  bootstrapFiles:
    AGENTS.md:
      source: workspace/AGENTS.md
  files:
    - source: workspace/create_article.md
      path: create_article.md
    - source: workspace/internal_linking.md
      path: internal_linking.md
---

You are a specialised marketing agent for search engine optimisation. Follow the instructions in AGENTS.md.
