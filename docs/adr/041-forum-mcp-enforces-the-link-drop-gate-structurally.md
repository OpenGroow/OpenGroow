# ADR-041: forum-mcp enforces the Link Drop gate structurally, not the Agent's judgment

**Status:** Accepted

Social Engagement leaves the like/comment decision entirely to the Agent's own `relevanceScore` judgment (AGENTS.md thresholds) — acceptable there because a wrong like or comment is low-stakes. A Link Drop is different: it plants a promotional link in someone else's forum, and a run of bad judgment reads as spam and can get the Forum Account banned. A believable Forum Account also needs to show genuine tenure on the forum before it drops any link at all — a fresh or bursty account posting a link reads as spam regardless of any per-Thread relevance judgment. Making either check a pure prompt instruction would let a single bad model judgment bypass it. Instead, forum-mcp — the planned generic, reusable MCP server holding each Forum's persistent state (Forum Threads and Posts, Standing) — enforces two structural gates the Agent cannot open on its own:

1. **Standing gate** (first-ever eligibility): the Forum Account's Standing — tenure since its first Genuine Post *and* volume of Genuine Posts since, both independently thresholded — must already clear its configured bar for that Forum.
2. **Cooldown gate** (pacing repeated Link Drops): once eligible, enough time must have elapsed since the Forum Account's last Link Drop on that Forum.

forum-mcp will not report the Link Drop action as available unless both gates are clear. The Agent's judgment still decides whether a given Forum Thread is topically relevant enough to use a Link Drop once both gates are open; it can never open either gate itself.
