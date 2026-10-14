# ADR-016: UI language — all English

**Status:** Accepted

### Context

The dashboard UI was built with **French labels** ("À valider", "À publier", "Réviser", "Publier", "Terminé", "Échoué"), and `GLOSSARY.md` declared these terms canonical. The **technical keys** (statuses `todo`, `doing`, `to_validate`…) are, meanwhile, already in English.

The arrival of the Missions Kanban forced the question: naming the columns in English without touching anything else would produce a **bilingual** UI (EN columns + FR buttons). The real decision is therefore about **the whole UI**, not just the board.

### Options considered

- **Keep French** (status quo): zero regression, but inconsistent with the English technical keys and with a target audience that isn't strictly French-speaking.
- **Bilingual UI** (EN columns, rest FR): inconsistent, confusing — discarded.
- **Anglicize everything**: all visible labels move to English.

### Decision

**All user-visible labels are in English.** The canonical UI terms become:

- Mission statuses: `To do` / `In progress` / `To validate` / `To publish` / `Done` / `Failed`.
- RunResult `needs_human_review` → **"To validate"** (canonical UI term).
- Action buttons, badges, headers: English.

The **technical keys** (`todo`, `doing`, `needs_human_review`…) remain unchanged — they were already in English and don't depend on this choice.

### Consequences

- **Cross-cutting effort**: all existing screens (mission pages, review, badges, CTAs) must move FR → EN, not just the new board.
- `GLOSSARY.md` is updated: "UI term" column and canonical notes in English.
- Decision **hard to reverse** once propagated throughout the UI and into user expectations.
- **Documentation prose** (GLOSSARY.md, ADRs) remains written in French: this choice concerns **product labels**, not the team's working language. **Superseded by ADR-027** — this constraint no longer holds; documentation prose is being migrated to English as well.
- If **internationalization** (FR + EN i18n) becomes necessary, that will be a new ADR; English then becomes the default locale.
