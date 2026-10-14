# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

This repo uses a single-context domain layout:

- `GLOSSARY.md` at the repo root: vision, bounded contexts and a term index (small, read it first)
- `docs/domain/*.md`: detailed definitions, one file per domain (project-and-agents, templates, missions, marketing-engine, android, runtime)
- ADRs under `docs/adr/`, one file per decision; `docs/adr/README.md` is the index with each ADR's status and whether it is still live

## Before exploring, read these

- `GLOSSARY.md` for the term index, then only the `docs/domain/` file of the area you work on.
- `docs/adr/README.md`, then the ADRs of that area. Check the "Live?" column: some older ADRs are superseded in practice.

If any of these files do not exist, proceed silently. The producer skill (`/grill-with-docs`) creates domain docs lazily when terms or decisions are resolved.

## Use the glossary's vocabulary

When output names a domain concept in an issue title, refactor proposal, hypothesis, or test name, use the term as defined in `GLOSSARY.md`. Do not drift to synonyms the glossary explicitly avoids.

If the concept needed is not in the glossary yet, either reconsider the language or note it for `/grill-with-docs`.

## Flag ADR conflicts

If output contradicts an existing ADR, surface it explicitly rather than silently overriding it.
