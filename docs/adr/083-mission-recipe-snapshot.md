# ADR-083: A Mission freezes a Recipe Snapshot at creation, injected through a context provider, and dispatches at its pinned Template version

**Status:** Accepted

## Context

Creative direction (a prompt, creative guard-rails) was mixed into the technical instructions of an Agent Template, so trying another mechanic meant releasing a new Template version. Production Recipes (issue #137), each written for one Mission type of one Template, now store that direction as data. Two questions remain: when the recipe is read, and how a Run receives it. A related defect: a Mission pins the Template version it was created with, but the dispatcher resolved the Template at the Project's current version, so a retry or a revision could run on newer instructions than the first Run.

## Decision

- **Recipe Versions are immutable.** An edit appends the next version. A saved version is never modified, so a Mission can always name exactly what it used.
- **The recipe is resolved once, at Mission creation.** `missions.create` accepts an optional `recipe` (a recipe id and an optional version). The server checks, in order: the recipe belongs to the Project and is not archived; it is written for the Mission's Template and Mission type; the pinned Template version declares the `production-recipe` provider. It then stores the **Recipe Snapshot** on the Mission (recipe, version, prompt, instructions, constraints). Nothing is written when a check fails. The snapshot is never recomputed, so editing or archiving the recipe later does not change existing Missions.
- **Injection goes through a context provider.** `production-recipe` is registered like the other providers and reads only the Mission's snapshot (no query). It renders a `Production Recipe` section in `context.md` for every Run: name and version, `Prompt (verbatim)`, `Instructions`, `Constraints`, and a statement that the Template's technical instructions and the Brand Core take precedence on conflict. A Mission without a snapshot renders nothing. The payload is untouched, so Mission types' own validators are unaffected.
- **Compatibility is evaluated against the pinned Template version.** A Mission type's declaration of the provider means "this version of the Template can consume a recipe". The creation check reads the manifest of the version the Mission is pinned to, not the current one, so a recipe is never silently ignored by instructions that do not know the section.
- **`templateVersion` can pin any installed version.** The optional argument accepts a version installed in the Project, current or staged, and is refused otherwise. Omitted, the Mission pins the current version as before. This lets a new Template release be tested on one Mission without applying it to every new Mission.
- **Technical and creative instructions are separate.** MCP and Manifest contract constraints stay in the Template; permanent product constraints stay in the Brand Core; constraints of the creative mechanic belong to the recipe and are guidance text, not validations.
- **Every Run of a Mission is dispatched at the Mission's pinned version** (base instructions, Mission-type instructions, declared providers). A Mission without a pinned version follows the current one. A pinned version that is no longer installed fails the Run with `template_version_missing`; there is no fallback to the current version. Job Runs follow the current version.

## Consequences

- A new compatible mechanic needs a recipe, not a Template release.
- A retry after a failed job and a revision after a rejection reproduce the first Run's direction.
- The provider name must be known to OpenGroow before a Template that declares it can be installed, so the OpenGroow change ships before the Template change.
- Schedules and other automatic creation paths do not carry a recipe; a Mission type that needs one must be checked before its Template version is applied.
- The Run-level context snapshot already stored for each Run keeps an audit copy of what was injected.
