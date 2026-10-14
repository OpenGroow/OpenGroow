# ADR-027: Documentation prose migrates from French to English — big-bang, docs only

**Status:** Accepted

### Context

The repo mixes languages: code, identifiers, comments, and (per ADR-016) all user-visible UI copy are in English, while `GLOSSARY.md` and `docs/adr/*.md` prose is written in French, with English domain terms embedded (`Mission`, `Run`, `Artifact`, ...). ADR-026 (`docs/adr/agents.md`) was written directly in English as a deliberate first step, flagging that `docs/adr` was expected to migrate to English over time.

A follow-up issue tracks closing this gap and was deliberately left unscoped (`ready-for-human`), since the migration approach — big-bang vs. incremental, docs vs. docs+UI — is a product/process call, not something to decide unilaterally mid-implementation.

### Options considered

- **Incremental, opportunistic** (translate a file only when it's next touched for unrelated reasons): slow, leaves the repo bilingual indefinitely, and the ADR-016 precedent (writing new ADRs in English going forward) already produces a permanently mixed `docs/adr/` directory.
- **Big-bang, docs + UI**: UI copy is already English per ADR-016 — there is no UI work left to do here, so bundling it in adds no scope, only confusion about what "UI" migration would even mean at this point.
- **Big-bang, docs only** (chosen): translate `GLOSSARY.md` and all of `docs/adr/*.md` to English in one coordinated pass, broken into independently-shippable issues (one per file) via `/to-issues`, rather than translating opportunistically.

### Decision

**Big-bang, docs only.** `GLOSSARY.md` and every file under `docs/adr/` are translated to English. Dashboard UI copy is out of scope for this migration — it is already English (ADR-016). This ADR itself is written in English, continuing the ADR-026 precedent; from this point on, all new ADRs and `GLOSSARY.md` edits are written in English directly rather than French-then-translated.

This supersedes the "documentation prose stays French" note in ADR-016's consequences.

### Consequences

- `docs/adr/*.md` and `GLOSSARY.md` become fully English once the follow-up issues (broken down via `/to-issues` from #246) land; until then the repo remains transiently bilingual, file by file.
- ADRs already written in French keep their historical wording until their file's translation issue lands — an ADR is a frozen historical record, not a living document, so partial mid-migration states are expected and not a defect.
- No further language decision is needed for the dashboard UI — ADR-016 already covers it.
