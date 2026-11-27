# ADR-090: Production Recipes are deleted, not archived

**Status:** Proposed

## Context

A Production Recipe could be archived (ADR-083): kept, read-only, offered nowhere. ADR-088 replaced archiving with deletion in the dashboard, but recipes archived before stayed `archived`, a state the user could no longer leave. A Planned Content (ADR-086) holds only a `recipeId`: the Recipe Snapshot is taken when a Mission is created, so a Planned Content not produced yet needs the live recipe.

## Decision

- **A recipe has no status.** `archive` and `unarchive` are gone, and so are every check, filter and `archived` flag (dashboard, Internal MCP, analytics, Strategic Memory references). `dropRecipeStatus` removes the field, so a recipe archived before is usable again; the field leaves the schema once it has run.
- **Deleting a recipe is never refused.** One mutation deletes the recipe, its versions and its Planned Contents not produced yet (the proposals of the draft plan, the approved contents dated today or later), found through `plannedContents.by_recipe_status_plannedAt`. The dashboard first reads their number (`production_recipes.deletionImpact`) and asks for confirmation.
- **History stays.** Missions keep their Recipe Snapshot and are dispatched, retried and resumed from it, never from the live recipe, so a Mission in progress is not interrupted. Publications stay attributed through the snapshot. Rejected and past Planned Contents stay, showing the recipe as deleted.

## Consequences

- An approved Planned Content dated in the past is treated as no longer to be produced. When Missions are created from approved Planned Contents, that rule is the one to revisit.
