# ADR-038: Review contracts are explicit for every reviewable Mission type

**Status:** Accepted

`review` as a Template-wide fallback is removed. A reviewable Agent Template must declare `missionTypes`, and each reviewable Mission type must place its explicit `review` contract inside its matching `missionTypes[]` entry; a Mission type with no reviewable Artifact has no `review` field. The same nesting rule applies to Mission-type `blockers`. This makes the review and blocker contracts match the domain boundary — a Mission type represents a distinct result — and prevents a newly added type from silently inheriting the wrong content path, actions, publication effect, or blocker vocabulary. Existing SEO, Video, and Social Engagement manifests must keep these contracts on their matching Mission-type entries; Templates without reviewable Missions remain valid without `review`.
