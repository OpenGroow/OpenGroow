# ADR-023: Autonomous comments without human approval in the Social Engagement agent

**Status:** Accepted

### Context

The Social Engagement agent must be able to post comments on Instagram. A comment is a public, permanent, immediately visible act: unlike a like (revocable, silent), a comment commits the brand's voice on a third-party post. The question was whether the agent should request human approval before posting.

### Options considered

- **A — Autonomous comment.** The agent writes and posts the comment during the engagement Session without human intervention. The comment appears in `report.json` with `decision: "commented"`; the human audits after the fact.
- **B — Draft without posting.** The agent writes the comment and records it with `decision: "comment_drafted"` in the report, but does not post it. A second Mission (or manual validation) is responsible for posting them. No public comment during the session.
- **C — Suspend for approval.** The session goes into `needs_human_review` for every candidate comment, waits for validation, then resumes. Breaks the time bound and creates N round-trips per session.

### Decision

**A — autonomous comment.** The agent comments without approval during the engagement Session.

**Reasons:**

1. **Consistency with the engagement Session model.** The Session is a time-bounded autonomous loop. Interrupting it for every comment (option C) breaks this contract and makes the time bound fictitious. Option B produces drafts that are useless without a second mission and a validation UI that's out of scope.
2. **Sufficient guardrails in the template.** The decision to comment requires a user-configured `commentWhen` **and** `relevanceScore >= 8/10` — a much higher threshold than for liking (`>= 5`). In practice, at most 1 to 2 comments per session. Per-session risk-taking is low.
3. **Post-hoc auditability.** Every posted comment appears in `report.json` with the exact text (`commentPosted`), the reason (`commentPostReason`), and the liked comments (`commentsLiked`). The human sees everything that was done and can adjust `commentWhen` accordingly.

### Consequences

- A poorly written comment is immediately public. The user must write `commentWhen` carefully — it's the main line of defense.
- If the quality of auto-generated comments proves insufficient in production, option B remains available as a fallback without a major architecture change (it's enough to remove the `add_comment` action from the loop).
