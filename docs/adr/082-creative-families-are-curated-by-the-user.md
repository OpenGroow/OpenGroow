# ADR-082: Creative Families are curated by the user, scoring no longer creates them

**Status:** Accepted (reverses part of ADR-051: scoring assigning a Creative Family)

## Context

ADR-051 had scoring assign every Source to a Creative Family, creating it by slug when it did not exist, with no human check. On a real Project this produced 18 families for 69 Sources: 7 empty, 3 with a single Source, and two holding 41 of the 69. Nothing in the product read these families, so the user could neither see nor correct them, and every newly scored Source added to the sprawl.

## Decision

- **Scoring only scores.** Applying a score writes the score record on the Source. It looks up, creates and assigns no Creative Family. A newly scored Source arrives unclassified.
- **A Creative Family is a list the user curates.** Its `description` states the creative mechanic its Sources share.
- **The scoring result contract tolerates the old field.** The family part of an entry is optional and ignored, so Agents installed earlier keep working. The run prompt no longer shows it. The Hub scoring instructions change only after this is deployed. Removal trigger: once the Hub scoring instructions no longer ask for a family and no installed Agent returns one, drop the tolerated `creativeFamily` entry field from the result contract.
- **Existing families and assignments are kept.** No backfill, no migration. The single `creativeFamilyId` on the Source stays the only link.
- **The Template-declared grouping is called Source group** to stop colliding with Creative Family. The stored column name does not change.

## Consequences

- The list stops growing by itself; classification becomes a user decision (read side and curation come in follow-up work).
- A scoring batch is never rejected for missing or extra family data.
