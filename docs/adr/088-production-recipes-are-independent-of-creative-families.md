# ADR-088: Production Recipes are independent of Creative Families

**Status:** Proposed

## Context

A Production Recipe belonged to one Creative Family (ADR-082, ADR-083), and Recipe Generation started from one family (ADR-087). That tied two different things together: a family groups external Sources that inspire us, a recipe is how we produce our own content. A recipe could not exist without a family, could not be inspired by an idea or by Sources from several families, and the performance of our productions was also aggregated by the family of their recipe (ADR-084).

## Decision

- **A Production Recipe has no Creative Family and no inspiration.** `creativeFamilyId` is removed from recipes. No Source, family or idea is stored on a recipe: once created it is autonomous.
- **Creating, generating, reviewing and deleting recipes happens in the Recipes workspace.** A Creative Family only groups Sources, with their external popularity.
- **Recipe Generation takes optional inspiration.** A free idea and/or Sources; a Creative Family is only a shortcut that selects its most recent `ready`, non-excluded Sources. At least a non-empty idea or one Source is required; at most 25 Sources, refused above that, never truncated silently. The resolved input is pinned on the Standalone Run only so its retries read the same input (ADR-087 is otherwise unchanged).
- **Performance is attributed to recipes only**, through the Recipe Snapshot. The aggregate by Creative Family (ADR-084) and the Creative Family of a Planned Content (ADR-086) are removed, as is the Strategy Agent's "underexplored Creative Families": exploration and exploitation are read at the recipe level.

## Consequences

- A recipe can be written with no inspiration, or from Sources of several families.
- A family's page loses its recipes, generation and performance; it shows Sources and their popularity.
- Existing recipes, Planned Contents and Standalone Runs are migrated once, with no permanent compatibility layer; Recipe Snapshots and the attribution of past Publications to recipes are untouched.
- Rejected: keeping the family as an optional recipe field (it would stay a second source of truth with a meaning nobody owns), and storing the inspiration on the recipe (a traceability mechanism nobody asked for).
