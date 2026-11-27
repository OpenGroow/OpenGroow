# PRD — Recipe-first Production

Terms (Bundled Recipe, Default Recipe, Custom Recipe, Recipe Compatibility, Recipe Snapshot, Mission Brief, Mission Payload, Content Type) are defined in `docs/domain/marketing-engine.md`, `docs/domain/missions.md` and `docs/domain/templates.md`. Decision: ADR-091.

## 1. Context

Any Mission can be created without a Production Recipe (Create Mission "No recipe", "Run now", Schedule tick), so many Publications are unattributed and a user who wants plain content has no path other than writing a recipe. Nothing in a Template says which Mission types produce content.

## 2. Objectives

Every creative Mission references a compatible Production Recipe, enforced by the server. A user can create freeform content without writing a recipe, or use a specialised one. New creative Publications are always attributable. Operational Missions and all historical data are untouched.

## 3. Constraints

- Reuse the existing recipe tables, versions and Recipe Snapshot. No new table.
- No change to the internal structure of recipes, no Fixed/Guided/Automatic, no Production Skills, Compiler, Production Manifest redesign, generic video MCP, Recipe Testing, marketplace, Mission Fields refactor, or Planned Content → Mission.
- The Template migration is minimal but functional: classification, `recipes/` folder, one Default per creative type, `agentsMd` reading the recipe. No MCP or composition refactor.

## 4. Template contract (`OpenGroow` reader and `groowhub`)

- Profile `schemaVersion: 2` for every Template, Strategy and Source included.
- `missionTypes[].kind`: `creative | operational`, required on every Mission type; no default, no third value. A Template without Mission types is valid and declares neither `kind` nor `recipes`.
- `recipes` is declared by creative Mission types only. They declare `recipes: [{ id, path, default? }]`: files in `recipes/` at the package root (not copied to the Agent workspace), exactly one default. A recipe file holds `name`, `description`, optional `prompt`, `instructions`, `constraints`.
- The validator (`groowhub-cli`) checks the kind, the files, the unique ids and the single default.
- Classification: `create_reel` (both), `create_article`, `create_carousel`, `create_single`, `create_letter_video`, `create_marketing_video`, `create_chat_mock_video` are creative; `engage`, `internal_linking` are operational. Source and Strategy declare only Job types and need nothing.
- Every creative type ships exactly one Bundled Recipe: a neutral `freeform` Default. No specialised Bundled Recipe is shipped in this step: the current video Template is to be replaced by a generic Video Agent, so a library built on its architecture would be wasted. Mission types, fields, payloads and MCP capabilities are kept as they are.
- Each creative `agentsMd` gains a short common instruction: read the `Production Recipe` section, then the Mission Brief. Nothing else is moved.

## 5. Data

- `productionRecipes`: optional `bundledId` (absent = Custom) and `isDefault`. Lookup by Project, Template, Mission type, `bundledId`. The transitional `creativeFamilyId` and `status` fields are dropped in the same schema edit.
- `schedules`: optional `recipeId`, optional `pausedReason`.
- No field on `publications` or `missions` (attribution stays the snapshot).

## 6. Behaviour

1. **Provisioning**, one idempotent function, called on Template install and link, on applying an update, on Agent activation, and by a backfill. It creates a recipe row and Version 1 if absent, a new Version only if the file content changed, and fixes `isDefault`. It then backfills the creative Schedules of that Template that have no recipe with its Default. A Bundled Recipe absent from the new manifest becomes a Custom (not Default), and the update plan shows it. A Custom is never touched; a returning Bundled Recipe becomes a new row.
2. **Guards**: edit, `setTarget` and `remove` refuse a Bundled Recipe. New `duplicate` copies the latest version into a Custom, without link. Deleting an Agent deletes no recipe: recipes belong to the Project, keep their target and are unusable until a compatible Agent exists; provisioning on reinstall finds them by identity. Only deleting the Project removes them.
3. **Mission creation**: the single insertion function requires, for a creative type, an explicit `recipe` that is compatible, and takes the snapshot. `createForOwner` receives the Schedule's `recipeId`. A missing Default (not provisioned) is an error, never a silent creation.
4. **Dispatch**: the `Production Recipe` section is rendered for every creative Mission. The `production-recipe` provider handling, `declaresRecipeProvider`, `acceptsRecipe` and the "No recipe" option are removed; the name remains accepted when reading stored manifests.
5. **Schedules**: creation, Default Schedules, the tick and "Run now" go through the same validation. A recipe deleted or no longer compatible pauses its Schedules (`recipe_unavailable`), `deletionImpact` lists them, `resume` is refused until `setRecipe` provides a compatible recipe, and `pausedReason` clears on that change without resuming.
6. **Strategy and Content Planning**: `list_production_recipes` returns `origin` (bundled or custom) and `isDefault`; the MCP renames the old `kind` field to `contentType` in `list_mission_types` and `list_production_recipes` with no alias, in every consumer and in the Strategy prompts, and `formatOf` and its "format" wording become Content Type. `resolveItem` also requires a creative type. The Strategy prompts in `groowhub` are read and adjusted for `contentType`.
7. **Creative Agent**: Recipe Generation can read Bundled Recipes through the existing catalog and use them as a base.
8. **UI**: Recipes page shows Bundled or Custom and the Default, offers view, use and duplicate for Bundled ones. The Create Mission and Create Schedule forms list only compatible recipes, preselect the Default, and have no empty choice.

## 7. Legacy and migration

- No compatibility with the old contracts. A Template version without the new contract is **outdated**: readable (history, review, Publications, Recipe Snapshots stay as they are), but no new execution starts from it until the Project updates. The renamed MCP field `contentType` has no alias.
- **Outdated** is a stored version whose profile `schemaVersion` is below 2. It is derived, never stored. It is read from its stored manifest, with no execution validator kept for it.
- **Blocked**: every new Run, at the point where the Run row is inserted (`dispatchRun` for Missions, the Job and Recipe Generation Runs). That covers Mission creation, retry, revision and resume, Schedule "Run now", Source, scoring, Strategic Review and Content Planning Jobs, and Recipe Generation. **Not blocked**: reading, Artifacts, approve and publish of existing content, and Runs already inserted, which run to the end, so a production in progress is not cut.
- **Schedules**: the tick skips an outdated Template's Schedule without creating a Mission, without `lastError`, advancing to the next occurrence. The Schedules page shows "Template outdated, update to resume". Status is unchanged and the Schedule resumes at its next occurrence after the update.
- **Dashboard**: the Template and Agent pages show the outdated state and the update offered; Create Mission and Run now say why they are unavailable.
- Missions, Runs, Publications and Recipe Snapshots are never rewritten. The Unattributed Publication concept stays for them.
- **Rollout** (no alias, no flag): (1) the product reader and a new `groowhub-cli` release; (2) the CLI pin and the schemaVersion 2 releases of every Template, Strategy included, in both hub repositories; an older deployment refuses them, so nobody can apply them early; (3) one deployment of the product that carries the blocking, the enforcement, the MCP rename and the Schedules; (4) right after it, the update of every Project's Templates (offered by `checkHubUpdates`, applied with `applyUpdate`, which provisions the recipes). The window between 3 and 4 is bounded by us and is the only one.

## 8. Acceptance criteria

- No creative Mission can be created, by the Composer, "Run now", a Schedule or any internal caller, without an explicit compatible recipe; the rejection is server-side.
- A user creates freeform content with the preselected Default, or picks a specialised recipe, without writing one.
- A Bundled Recipe cannot be edited, retargeted or deleted on its own, and can be duplicated.
- Provisioning twice changes nothing; an unchanged Template update adds no Version.
- A removed Bundled Recipe becomes a Custom with its history; a deleted or incompatible recipe pauses its Schedules and blocks their resume.
- The Strategy Agent proposes a Planned Content only with a compatible recipe; Content Planning and Mission creation apply the same compatibility rule.
- New creative Publications are attributed through the snapshot; historical data is unchanged; operational Missions behave as before.

## 9. Test plan

Server: compatibility matrix (other Project, other Template or type, operational type, version without `kind`), provisioning idempotency and update, retired and returning recipes, guards, Schedule pause and resume, `createForOwner` with a recipe. Package: `kind` and `recipes` validation, old manifests still readable. Dashboard: Composer preselect and no empty option, Bundled badge and hidden actions.
