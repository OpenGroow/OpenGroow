# ADR-087: Recipe Generation runs as a Standalone Run, and an Agent holds one Standalone Run at a time

**Status:** Proposed

## Context

Writing Production Recipes by hand slows down experimenting with the system. The user should be able to ask the Strategy Agent, from a Creative Family, for a Recipe Proposal to review in the existing creation form (ADR-082, ADR-083). Until now an Agent only ran for a Mission or for a Job (ADR-085, ADR-086), and a Job is recurring work with a recurrence, a Run Now and a row in `jobs`. A generation is neither: nobody schedules it, it carries inputs (a family, free instructions), and several can be asked over time. Two more constraints: the Agent token carries no Run, so a tool finds the pinned inputs by looking for the Agent's running Run (ADR-080), and an Agent can have a scheduled Job due at any time.

## Decision

- **A new kind of Run, a Standalone Run**: a third form of the `runs` union, with neither `missionId` nor `jobId` and a required `recipeGeneration` pin (the family, the optional instructions, the try count and the feedback of a refused result). It reuses the existing dispatch, reconciliation, timeout and failure handling; only what depends on the parent (workspace paths, the settle and fail hooks) gains a third branch. No table, no Job row and no Recipe status is added. Nothing is built for other on-demand actions: a second one generalizes the branch then.
- **The Recipe Generation's instructions are written by OpenGroow in the Run's `run.md`**, not in the Agent Template: the Template contract and `jobTypes` do not change. The Template only declares the Internal MCP tools it needs. `generateRecipe` picks the first active Agent that declares all of them and refuses with a clear message if none does.
- **One Run in flight per Agent when a Standalone Run is involved.** `generateRecipe` is refused while its Agent has any Run `pending`, `dispatching`, `running` or `awaiting_job`. The scheduled Strategic Review and Content Planning passes of that Agent `continue` without writing anything while a Standalone Run is in flight: the Job stays due and starts on a later tick, a Run Now request stays queued. This differs from "a Run is already in flight" for their own Run, which still ends `skipped`.
- **The exclusion is transactional.** The checks and the insert of the Run happen in one Convex mutation, reading the Agent's Runs by `by_instance_template_status`; the ticks read the same range. Convex then serializes a clashing pair (one retries and sees the other). A retry after an invalid result is inserted in the same mutation that fails the previous Run, so the lock is never released between tries.
- **Because the Agent runs nothing else meanwhile, the pinned inputs are unambiguous**: a tool that reads Sources finds the one running Standalone Run of the Agent, limits itself to the pinned family and refuses outside such a Run.
- **The result is stored on the Run** (`recipeProposal`), validated by OpenGroow before it is shown. Creating a recipe from it stamps the Run in the creation mutation, so one proposal creates at most one recipe, and the Run must belong to the same Project and family.

## Consequences

- A generation is refused ("Agent busy") when the Agent is working, and delays its scheduled Jobs by at most its own duration.
- Mutual exclusion is per Agent. Two Agents of one Project can still run in parallel, but only one Agent is eligible per Recipe Generation, so one generation per Project in practice.
- The Strategy Agent's Hub package needs only a longer `internal.tools` list; the CLI needs a release for the new tool names only.
- The `runs` schema union changes and every `runParent` reader handles a third kind.
