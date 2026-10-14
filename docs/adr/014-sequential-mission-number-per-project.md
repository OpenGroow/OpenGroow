# ADR-014: Sequential Mission number per Project

**Status:** Accepted

### Context

The Mission Kanban board (per-Project board) must present cards that non-technical marketers can recognize and reference (_"look at mission 14"_). Today a Mission only has its Convex `_id` (e.g. `k17d9f2a…`): unreadable, unordered, impossible to dictate out loud.

### Options considered

- **`_id` suffix** (e.g. last 4 characters → "Mission a4f2"): zero new data, zero migration, but neither ordered nor really human.
- **Per-type sequence** ("SEO Article #3", "Audit #1"): nice in the label, but two missions could carry the same "#3" within the same project — ambiguous out loud.
- **Per-Project sequence**: a unique increasing integer within the project, across all types.

### Decision

Each Mission is assigned a **sequential number per Project**, allocated at creation, **stable for life**, increasing across all types combined. The Convex `_id` is never shown to the user.

The number is allocated via a **persistent counter per Project** (dedicated table or field on the Project), incremented in the same transaction as the Mission creation to guarantee uniqueness under concurrent creation.

### Consequences

- A **persistent counter** must be maintained per Project; the allocation must be atomic with the Mission's `insert` to avoid collisions (two missions created in parallel).
- Missions **already in the database** must be **backfilled** by a migration (retroactively numbered by creation order within each project).
- **Hard decision to reverse** once numbers are exposed and referenced by users: changing the scheme (e.g. switching to per-type) would break mental references and any existing links.
- The number is a **business identity** property of the Mission (see "Mission Identity" in `GLOSSARY.md`), not a display detail.
